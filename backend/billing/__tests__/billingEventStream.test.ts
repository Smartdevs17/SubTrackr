/**
 * Unit tests — Billing Event Stream Processing (Issue #1284)
 *
 * Covers:
 *  - BillingEventStream: start/stop, event dispatch, batching, pause/resume, drain, metrics
 *  - BillingStreamProducer: all new charge lifecycle events + delegated events
 *  - NotificationConsumer: correct events trigger notifications
 *  - AnalyticsConsumer: correct metrics are recorded per event type
 *  - FraudDetectionConsumer: failure velocity tracking, evaluation calls
 *  - WebhookDispatchConsumer: allow-list filtering, correct payloads
 *  - Consumer error isolation: one failing consumer does not affect others
 */

import { EventBus, SpyEventBus, InMemoryEventStore } from '../../services/shared/events';
import { BillingEventStream } from '../stream/BillingEventStream';
import { BillingStreamProducer } from '../stream/BillingStreamProducer';
import {
  NotificationConsumer,
  AnalyticsConsumer,
  FraudDetectionConsumer,
  WebhookDispatchConsumer,
} from '../stream/consumers';
import type {
  BillingStreamConsumer,
  BillingStreamEvent,
  NotificationSink,
  AnalyticsSink,
  FraudDetectionSink,
  WebhookDispatchSink,
  WebhookPayload,
} from '../stream';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A simple in-memory consumer used to record received batches. */
class CapturingConsumer implements BillingStreamConsumer {
  readonly name: string;
  readonly batches: BillingStreamEvent[][] = [];
  pauseCalled = false;
  resumeCalled = false;
  private readonly shouldThrow: boolean;

  constructor(name = 'CapturingConsumer', shouldThrow = false) {
    this.name = name;
    this.shouldThrow = shouldThrow;
  }

  async handleBatch(events: BillingStreamEvent[]): Promise<void> {
    if (this.shouldThrow) throw new Error('deliberate consumer error');
    this.batches.push([...events]);
  }

  async onPause(): Promise<void> {
    this.pauseCalled = true;
  }

  async onResume(): Promise<void> {
    this.resumeCalled = true;
  }

  get allEvents(): BillingStreamEvent[] {
    return this.batches.flat();
  }
}

/** Returns a fresh EventBus + EventStore + BillingStreamProducer triple. */
function makeSetup() {
  const bus = new EventBus();
  const store = new InMemoryEventStore();
  const producer = new BillingStreamProducer(bus, store);
  return { bus, store, producer };
}

// ---------------------------------------------------------------------------
// BillingEventStream — core stream
// ---------------------------------------------------------------------------

describe('BillingEventStream', () => {
  describe('start / stop', () => {
    it('receives billing events after start()', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      await producer.publishChargeAttempted({
        chargeId: 'chg_1',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 99,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 1,
      });

      await stream.drain();
      stream.stop();

      expect(consumer.allEvents).toHaveLength(1);
      expect(consumer.allEvents[0].name).toBe('billing.charge_attempted');
    });

    it('does not receive events before start()', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      // NOT calling stream.start()

      await producer.publishChargeAttempted({
        chargeId: 'chg_1',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 99,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 1,
      });

      expect(consumer.allEvents).toHaveLength(0);
    });

    it('stops receiving events after stop()', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      await producer.publishChargeAttempted({
        chargeId: 'chg_1',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 99,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 1,
      });
      await stream.drain();
      stream.stop();

      // Publish after stop — should not arrive
      await producer.publishChargeFailed({
        chargeId: 'chg_2',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 99,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 2,
        failureCode: 'card_declined',
        failureReason: 'Card declined',
        retriable: true,
      });

      expect(consumer.allEvents).toHaveLength(1);
    });

    it('start() is idempotent', () => {
      const { bus } = makeSetup();
      const stream = new BillingEventStream({}, bus);
      stream.start();
      expect(() => stream.start()).not.toThrow();
      stream.stop();
    });
  });

  describe('batching', () => {
    it('dispatches a full batch immediately when batchSize is reached', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 3, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      // Publish 3 events — should trigger an immediate flush
      for (let i = 0; i < 3; i++) {
        await producer.publishChargeAttempted({
          chargeId: `chg_${i}`,
          subscriptionId: 'sub_1',
          userId: 'usr_1',
          amount: 10,
          currency: 'USD',
          gateway: 'stripe',
          attemptNumber: i + 1,
        });
      }

      await flushPromises();
      stream.stop();

      expect(consumer.allEvents).toHaveLength(3);
    });

    it('splits oversized event volumes into multiple batches', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 2, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      for (let i = 0; i < 5; i++) {
        await producer.publishChargeAttempted({
          chargeId: `chg_${i}`,
          subscriptionId: 'sub_1',
          userId: 'usr_1',
          amount: 10,
          currency: 'USD',
          gateway: 'stripe',
          attemptNumber: i + 1,
        });
      }

      await stream.drain();
      stream.stop();

      expect(consumer.allEvents).toHaveLength(5);
    });
  });

  describe('pause / resume', () => {
    it('notifies consumers when paused', async () => {
      const { bus } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      await stream.pause();
      expect(consumer.pauseCalled).toBe(true);
      stream.stop();
    });

    it('notifies consumers when resumed', async () => {
      const { bus } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      await stream.pause();
      await stream.resume();
      expect(consumer.resumeCalled).toBe(true);
      stream.stop();
    });

    it('buffers events while paused and flushes on resume', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      await stream.pause();

      // Publish while paused
      await producer.publishChargeAttempted({
        chargeId: 'chg_paused',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 50,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 1,
      });

      // Events buffered but not dispatched yet
      expect(consumer.allEvents).toHaveLength(0);
      expect(stream.getMetrics().bufferDepth).toBe(1);

      await stream.resume();
      await flushPromises();
      stream.stop();

      expect(consumer.allEvents).toHaveLength(1);
    });

    it('pause() is idempotent', async () => {
      const { bus } = makeSetup();
      const stream = new BillingEventStream({}, bus);
      stream.start();
      await stream.pause();
      const metrics1 = stream.getMetrics().pauses;
      await stream.pause(); // second call is a no-op
      expect(stream.getMetrics().pauses).toBe(metrics1);
      stream.stop();
    });

    it('resume() is idempotent when not paused', async () => {
      const { bus } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({}, bus);
      stream.registerConsumer(consumer);
      stream.start();
      await stream.resume(); // not paused — no-op
      expect(consumer.resumeCalled).toBe(false);
      stream.stop();
    });
  });

  describe('drain', () => {
    it('drain() flushes all buffered events', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      // Large flushInterval — drain must flush manually
      const stream = new BillingEventStream({ batchSize: 100, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      for (let i = 0; i < 5; i++) {
        await producer.publishChargeFailed({
          chargeId: `chg_${i}`,
          subscriptionId: 'sub_1',
          userId: 'usr_1',
          amount: 100,
          currency: 'USD',
          gateway: 'stripe',
          attemptNumber: i + 1,
          failureCode: 'insufficient_funds',
          failureReason: 'Insufficient funds',
          retriable: true,
        });
      }

      // Buffer has 5 events — not yet dispatched
      expect(consumer.allEvents).toHaveLength(0);

      await stream.drain();
      stream.stop();

      expect(consumer.allEvents).toHaveLength(5);
    });
  });

  describe('metrics', () => {
    it('tracks received and dispatched counts', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      for (let i = 0; i < 3; i++) {
        await producer.publishChargeAttempted({
          chargeId: `chg_${i}`,
          subscriptionId: 'sub_1',
          userId: 'usr_1',
          amount: 10,
          currency: 'USD',
          gateway: 'stripe',
          attemptNumber: 1,
        });
      }

      await stream.drain();
      stream.stop();

      const m = stream.getMetrics();
      expect(m.received).toBe(3);
      expect(m.dispatched).toBe(3);
      expect(m.errors).toBe(0);
      expect(m.paused).toBe(false);
    });

    it('tracks error count when consumer throws', async () => {
      const { bus, producer } = makeSetup();
      const throwing = new CapturingConsumer('thrower', true);
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(throwing);
      stream.start();

      await producer.publishChargeAttempted({
        chargeId: 'chg_err',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 10,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 1,
      });

      await stream.drain();
      stream.stop();

      expect(stream.getMetrics().errors).toBeGreaterThanOrEqual(1);
    });

    it('resetMetrics() zeroes all counters', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      await producer.publishChargeAttempted({
        chargeId: 'chg_1',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 10,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 1,
      });
      await stream.drain();

      stream.resetMetrics();
      const m = stream.getMetrics();
      expect(m.received).toBe(0);
      expect(m.dispatched).toBe(0);
      expect(m.errors).toBe(0);
      stream.stop();
    });
  });

  describe('consumer error isolation', () => {
    it('a throwing consumer does not prevent other consumers from receiving events', async () => {
      const { bus, producer } = makeSetup();
      const good = new CapturingConsumer('good');
      const bad = new CapturingConsumer('bad', true /* throws */);
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(bad);
      stream.registerConsumer(good);
      stream.start();

      await producer.publishInvoiceGenerated({
        invoiceId: 'inv_1',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 100,
        currency: 'USD',
        dueDate: Date.now() + 86_400_000,
      });

      await stream.drain();
      stream.stop();

      // bad consumer errored but good consumer still got the event
      expect(good.allEvents).toHaveLength(1);
      expect(stream.getMetrics().errors).toBe(1);
    });
  });

  describe('non-billing events are ignored', () => {
    it('does not buffer subscription or analytics events', async () => {
      const bus = new EventBus();
      const store = new InMemoryEventStore();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      // Publish a subscription event — should be ignored
      const { buildEvent } = await import('../../services/shared/events');
      const subEvent = buildEvent(
        'subscription',
        'created',
        {
          subscriptionId: 'sub_x',
          userId: 'usr_x',
          planId: 'plan_x',
          status: 'active',
          billingCycle: 'monthly',
          nextBillingDate: Date.now(),
        },
        {},
      );
      store.append(subEvent);
      await bus.publish(subEvent);

      await stream.drain();
      stream.stop();

      expect(consumer.allEvents).toHaveLength(0);
    });
  });

  describe('consumer registration', () => {
    it('registerConsumer returns this for chaining', () => {
      const { bus } = makeSetup();
      const stream = new BillingEventStream({}, bus);
      const consumer = new CapturingConsumer();
      const result = stream.registerConsumer(consumer);
      expect(result).toBe(stream);
      stream.stop();
    });

    it('removeConsumer prevents further delivery', async () => {
      const { bus, producer } = makeSetup();
      const consumer = new CapturingConsumer();
      const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
      stream.registerConsumer(consumer);
      stream.start();

      await producer.publishChargeAttempted({
        chargeId: 'chg_1',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 10,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 1,
      });
      await stream.drain();

      stream.removeConsumer(consumer);

      await producer.publishChargeAttempted({
        chargeId: 'chg_2',
        subscriptionId: 'sub_1',
        userId: 'usr_1',
        amount: 10,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 2,
      });
      await stream.drain();
      stream.stop();

      // Only the first event should have been received
      expect(consumer.allEvents).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// BillingStreamProducer
// ---------------------------------------------------------------------------

describe('BillingStreamProducer', () => {
  it('publishes billing.charge_attempted with correct shape', async () => {
    const spy = new SpyEventBus();
    const store = new InMemoryEventStore();
    const producer = new BillingStreamProducer(spy, store);

    await producer.publishChargeAttempted({
      chargeId: 'chg_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 150,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
    });

    expect(spy.published).toHaveLength(1);
    const evt = spy.published[0];
    expect(evt.name).toBe('billing.charge_attempted');
    expect(evt.payload.chargeId).toBe('chg_1');
    expect(evt.payload.amount).toBe(150);
    expect(evt.aggregateId).toBe('sub_1');
    expect(typeof evt.payload.attemptedAt).toBe('number');
  });

  it('publishes billing.charge_failed with correct shape', async () => {
    const spy = new SpyEventBus();
    const store = new InMemoryEventStore();
    const producer = new BillingStreamProducer(spy, store);

    await producer.publishChargeFailed({
      chargeId: 'chg_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 150,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
      failureCode: 'card_declined',
      failureReason: 'Your card was declined.',
      retriable: true,
    });

    const evt = spy.published[0];
    expect(evt.name).toBe('billing.charge_failed');
    expect(evt.payload.failureCode).toBe('card_declined');
    expect(evt.payload.retriable).toBe(true);
    expect(typeof evt.payload.failedAt).toBe('number');
  });

  it('publishes billing.charge_retried with correct shape', async () => {
    const spy = new SpyEventBus();
    const store = new InMemoryEventStore();
    const producer = new BillingStreamProducer(spy, store);
    const previousAttemptAt = Date.now() - 3600_000;

    await producer.publishChargeRetried({
      chargeId: 'chg_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 150,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 2,
      previousAttemptAt,
      nextRetryAt: Date.now() + 3600_000,
    });

    const evt = spy.published[0];
    expect(evt.name).toBe('billing.charge_retried');
    expect(evt.payload.attemptNumber).toBe(2);
    expect(evt.payload.previousAttemptAt).toBe(previousAttemptAt);
    expect(typeof evt.payload.retriedAt).toBe('number');
  });

  it('publishes billing.subscription_cancelled_billing with correct shape', async () => {
    const spy = new SpyEventBus();
    const store = new InMemoryEventStore();
    const producer = new BillingStreamProducer(spy, store);

    await producer.publishSubscriptionCancelledBilling({
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      reason: 'Payment failed 3 times',
      totalFailedAttempts: 3,
    });

    const evt = spy.published[0];
    expect(evt.name).toBe('billing.subscription_cancelled_billing');
    expect(evt.payload.totalFailedAttempts).toBe(3);
    expect(typeof evt.payload.cancelledAt).toBe('number');
  });

  it('appends events to the EventStore', async () => {
    const bus = new EventBus();
    const store = new InMemoryEventStore();
    const producer = new BillingStreamProducer(bus, store);

    await producer.publishChargeAttempted({
      chargeId: 'chg_store',
      subscriptionId: 'sub_store',
      userId: 'usr_1',
      amount: 100,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
    });

    const events = store.query({ aggregateId: 'sub_store' });
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('billing.charge_attempted');
  });

  it('uses provided timestamp when attemptedAt is supplied', async () => {
    const spy = new SpyEventBus();
    const store = new InMemoryEventStore();
    const producer = new BillingStreamProducer(spy, store);
    const ts = 1_700_000_000_000;

    await producer.publishChargeAttempted({
      chargeId: 'chg_ts',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 10,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
      attemptedAt: ts,
    });

    expect(spy.published[0].payload.attemptedAt).toBe(ts);
  });

  it('delegates to BillingEventPublisher for invoice events', async () => {
    const spy = new SpyEventBus();
    const store = new InMemoryEventStore();
    const producer = new BillingStreamProducer(spy, store);

    await producer.publishInvoiceGenerated({
      invoiceId: 'inv_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 299,
      currency: 'USD',
      dueDate: Date.now() + 30 * 86_400_000,
    });

    expect(spy.published[0].name).toBe('billing.invoice_generated');
  });
});

// ---------------------------------------------------------------------------
// NotificationConsumer
// ---------------------------------------------------------------------------

describe('NotificationConsumer', () => {
  function makeNotificationSink() {
    const calls: { userId: string; type: string; data: Record<string, unknown> }[] = [];
    const sink: NotificationSink = {
      async sendNotification(userId, type, data) {
        calls.push({ userId, type, data });
      },
    };
    return { sink, calls };
  }

  it('sends payment_success on billing.payment_captured', async () => {
    const { sink, calls } = makeNotificationSink();
    const consumer = new NotificationConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishPaymentCaptured({
      paymentId: 'pay_1',
      subscriptionId: 'sub_1',
      userId: 'usr_notify',
      amount: 99,
      currency: 'USD',
      capturedAt: Date.now(),
      gateway: 'stripe',
    });

    await stream.drain();
    stream.stop();

    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBe('usr_notify');
    expect(calls[0].type).toBe('payment_success');
    expect(calls[0].data.amount).toBe(99);
  });

  it('sends charge_failed on billing.charge_failed', async () => {
    const { sink, calls } = makeNotificationSink();
    const consumer = new NotificationConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargeFailed({
      chargeId: 'chg_1',
      subscriptionId: 'sub_1',
      userId: 'usr_notify',
      amount: 99,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
      failureCode: 'card_declined',
      failureReason: 'Card declined',
      retriable: true,
    });

    await stream.drain();
    stream.stop();

    expect(calls[0].type).toBe('charge_failed');
    expect(calls[0].data.retriable).toBe(true);
  });

  it('sends invoice_generated notification', async () => {
    const { sink, calls } = makeNotificationSink();
    const consumer = new NotificationConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishInvoiceGenerated({
      invoiceId: 'inv_1',
      subscriptionId: 'sub_1',
      userId: 'usr_notify',
      amount: 149,
      currency: 'USD',
      dueDate: Date.now() + 86_400_000,
    });

    await stream.drain();
    stream.stop();

    expect(calls[0].type).toBe('invoice_generated');
    expect(calls[0].data.invoiceId).toBe('inv_1');
  });

  it('sends subscription_cancelled_billing notification', async () => {
    const { sink, calls } = makeNotificationSink();
    const consumer = new NotificationConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishSubscriptionCancelledBilling({
      subscriptionId: 'sub_1',
      userId: 'usr_notify',
      reason: 'Billing exhausted',
      totalFailedAttempts: 3,
    });

    await stream.drain();
    stream.stop();

    expect(calls[0].type).toBe('subscription_cancelled_billing');
  });

  it('does not send notifications for non-actionable events (e.g. charge_attempted)', async () => {
    const { sink, calls } = makeNotificationSink();
    const consumer = new NotificationConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargeAttempted({
      chargeId: 'chg_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 50,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
    });

    await stream.drain();
    stream.stop();

    expect(calls).toHaveLength(0);
  });

  it('continues processing remaining events if one fails', async () => {
    let callCount = 0;
    const faultySink: NotificationSink = {
      async sendNotification() {
        callCount++;
        if (callCount === 1) throw new Error('first notification failed');
      },
    };
    const consumer = new NotificationConsumer(faultySink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    // Publish two payment_captured events
    for (let i = 0; i < 2; i++) {
      await producer.publishPaymentCaptured({
        paymentId: `pay_${i}`,
        subscriptionId: 'sub_1',
        userId: `usr_${i}`,
        amount: 99,
        currency: 'USD',
        capturedAt: Date.now(),
        gateway: 'stripe',
      });
    }

    await stream.drain();
    stream.stop();

    // Both events tried to notify; callCount should be 2
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AnalyticsConsumer
// ---------------------------------------------------------------------------

describe('AnalyticsConsumer', () => {
  function makeAnalyticsSink() {
    const records: { metric: string; value: number; tags: Record<string, string | number> }[] = [];
    const sink: AnalyticsSink = {
      async record(metric, value, tags) {
        records.push({ metric, value, tags });
      },
    };
    return { sink, records };
  }

  it('records billing.payment_captured metric with amount', async () => {
    const { sink, records } = makeAnalyticsSink();
    const consumer = new AnalyticsConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishPaymentCaptured({
      paymentId: 'pay_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 250,
      currency: 'EUR',
      capturedAt: Date.now(),
      gateway: 'adyen',
    });

    await stream.drain();
    stream.stop();

    expect(records).toHaveLength(1);
    expect(records[0].metric).toBe('billing.payment_captured');
    expect(records[0].value).toBe(250);
    expect(records[0].tags.currency).toBe('EUR');
    expect(records[0].tags.gateway).toBe('adyen');
  });

  it('records billing.charge_attempt metric with count 1', async () => {
    const { sink, records } = makeAnalyticsSink();
    const consumer = new AnalyticsConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargeAttempted({
      chargeId: 'chg_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 100,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
    });

    await stream.drain();
    stream.stop();

    expect(records[0].metric).toBe('billing.charge_attempt');
    expect(records[0].value).toBe(1);
  });

  it('records billing.charge_failure with failure code tag', async () => {
    const { sink, records } = makeAnalyticsSink();
    const consumer = new AnalyticsConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargeFailed({
      chargeId: 'chg_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 100,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
      failureCode: 'insufficient_funds',
      failureReason: 'Insufficient funds',
      retriable: false,
    });

    await stream.drain();
    stream.stop();

    expect(records[0].metric).toBe('billing.charge_failure');
    expect(records[0].tags.failureCode).toBe('insufficient_funds');
    expect(records[0].tags.retriable).toBe('false');
  });

  it('records billing.charge_retry metric', async () => {
    const { sink, records } = makeAnalyticsSink();
    const consumer = new AnalyticsConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargeRetried({
      chargeId: 'chg_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 100,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 2,
      previousAttemptAt: Date.now() - 3600_000,
    });

    await stream.drain();
    stream.stop();

    expect(records[0].metric).toBe('billing.charge_retry');
  });

  it('records billing.chargeback with amount', async () => {
    const { sink, records } = makeAnalyticsSink();
    const consumer = new AnalyticsConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargebackRaised({
      chargebackId: 'cb_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 99,
      currency: 'USD',
      reason: 'fraudulent',
      raisedAt: Date.now(),
    });

    await stream.drain();
    stream.stop();

    expect(records[0].metric).toBe('billing.chargeback');
    expect(records[0].value).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// FraudDetectionConsumer
// ---------------------------------------------------------------------------

describe('FraudDetectionConsumer', () => {
  function makeNoopFraudSink() {
    const evaluations: { subscriptionId: string; eventName: string }[] = [];
    const sink: FraudDetectionSink = {
      async evaluate(subscriptionId, eventName) {
        evaluations.push({ subscriptionId, eventName });
        return { eventId: '', subscriptionId, riskScore: 0, signals: [], blocked: false };
      },
    };
    return { sink, evaluations };
  }

  it('calls evaluate for billing.charge_failed', async () => {
    const { sink, evaluations } = makeNoopFraudSink();
    const consumer = new FraudDetectionConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargeFailed({
      chargeId: 'chg_1',
      subscriptionId: 'sub_fraud',
      userId: 'usr_1',
      amount: 99,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
      failureCode: 'do_not_honor',
      failureReason: 'Do not honor',
      retriable: false,
    });

    await stream.drain();
    stream.stop();

    expect(evaluations).toHaveLength(1);
    expect(evaluations[0].subscriptionId).toBe('sub_fraud');
    expect(evaluations[0].eventName).toBe('billing.charge_failed');
  });

  it('increments failure count on charge_failed', async () => {
    const { sink } = makeNoopFraudSink();
    const consumer = new FraudDetectionConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    for (let i = 0; i < 3; i++) {
      await producer.publishChargeFailed({
        chargeId: `chg_${i}`,
        subscriptionId: 'sub_vel',
        userId: 'usr_1',
        amount: 99,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: i + 1,
        failureCode: 'card_declined',
        failureReason: 'Declined',
        retriable: true,
      });
    }

    await stream.drain();
    stream.stop();

    expect(consumer.getFailureCount('sub_vel')).toBe(3);
  });

  it('resets failure count on payment_captured', async () => {
    const { sink } = makeNoopFraudSink();
    const consumer = new FraudDetectionConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargeFailed({
      chargeId: 'chg_1',
      subscriptionId: 'sub_reset',
      userId: 'usr_1',
      amount: 99,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
      failureCode: 'card_declined',
      failureReason: 'Declined',
      retriable: true,
    });

    await producer.publishPaymentCaptured({
      paymentId: 'pay_1',
      subscriptionId: 'sub_reset',
      userId: 'usr_1',
      amount: 99,
      currency: 'USD',
      capturedAt: Date.now(),
      gateway: 'stripe',
    });

    await stream.drain();
    stream.stop();

    expect(consumer.getFailureCount('sub_reset')).toBe(0);
  });

  it('does not evaluate irrelevant events (invoice_generated)', async () => {
    const { sink, evaluations } = makeNoopFraudSink();
    const consumer = new FraudDetectionConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishInvoiceGenerated({
      invoiceId: 'inv_1',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 99,
      currency: 'USD',
      dueDate: Date.now() + 86_400_000,
    });

    await stream.drain();
    stream.stop();

    expect(evaluations).toHaveLength(0);
  });

  it('handles high-risk evaluation without throwing', async () => {
    const highRiskSink: FraudDetectionSink = {
      async evaluate(subscriptionId, eventName) {
        return {
          eventId: 'evt_x',
          subscriptionId,
          riskScore: 0.95,
          signals: ['velocity_high', 'amount_anomaly'],
          blocked: true,
        };
      },
    };
    const consumer = new FraudDetectionConsumer(highRiskSink, 0.8);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await expect(
      producer.publishChargeFailed({
        chargeId: 'chg_high',
        subscriptionId: 'sub_high',
        userId: 'usr_1',
        amount: 9999,
        currency: 'USD',
        gateway: 'stripe',
        attemptNumber: 1,
        failureCode: 'do_not_honor',
        failureReason: 'Do not honor',
        retriable: false,
      }),
    ).resolves.toBeUndefined();

    await stream.drain();
    stream.stop();

    expect(stream.getMetrics().errors).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WebhookDispatchConsumer
// ---------------------------------------------------------------------------

describe('WebhookDispatchConsumer', () => {
  function makeWebhookSink() {
    const dispatches: { subscriptionId: string; payload: WebhookPayload }[] = [];
    const sink: WebhookDispatchSink = {
      async dispatch(subscriptionId, payload) {
        dispatches.push({ subscriptionId, payload });
        return { delivered: true, statusCode: 200 };
      },
    };
    return { sink, dispatches };
  }

  it('dispatches billing.payment_captured webhook', async () => {
    const { sink, dispatches } = makeWebhookSink();
    const consumer = new WebhookDispatchConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishPaymentCaptured({
      paymentId: 'pay_wh_1',
      subscriptionId: 'sub_wh',
      userId: 'usr_1',
      amount: 199,
      currency: 'USD',
      capturedAt: Date.now(),
      gateway: 'stripe',
    });

    await stream.drain();
    stream.stop();

    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].subscriptionId).toBe('sub_wh');
    expect(dispatches[0].payload.eventName).toBe('billing.payment_captured');
    expect(dispatches[0].payload.data.amount).toBe(199);
  });

  it('dispatches billing.charge_failed webhook', async () => {
    const { sink, dispatches } = makeWebhookSink();
    const consumer = new WebhookDispatchConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargeFailed({
      chargeId: 'chg_wh',
      subscriptionId: 'sub_wh',
      userId: 'usr_1',
      amount: 99,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
      failureCode: 'card_declined',
      failureReason: 'Card declined',
      retriable: true,
    });

    await stream.drain();
    stream.stop();

    expect(dispatches[0].payload.eventName).toBe('billing.charge_failed');
  });

  it('does NOT dispatch billing.charge_attempted (not in allow-list)', async () => {
    const { sink, dispatches } = makeWebhookSink();
    const consumer = new WebhookDispatchConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishChargeAttempted({
      chargeId: 'chg_1',
      subscriptionId: 'sub_wh',
      userId: 'usr_1',
      amount: 99,
      currency: 'USD',
      gateway: 'stripe',
      attemptNumber: 1,
    });

    await stream.drain();
    stream.stop();

    expect(dispatches).toHaveLength(0);
  });

  it('dispatches billing.subscription_cancelled_billing webhook', async () => {
    const { sink, dispatches } = makeWebhookSink();
    const consumer = new WebhookDispatchConsumer(sink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishSubscriptionCancelledBilling({
      subscriptionId: 'sub_wh',
      userId: 'usr_1',
      reason: 'Billing exhausted',
      totalFailedAttempts: 4,
    });

    await stream.drain();
    stream.stop();

    expect(dispatches[0].payload.eventName).toBe('billing.subscription_cancelled_billing');
  });

  it('setAllowedEvents dynamically updates the allow-list', async () => {
    const { sink, dispatches } = makeWebhookSink();
    const consumer = new WebhookDispatchConsumer(sink, []);
    // Empty allow-list — nothing dispatched
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishPaymentCaptured({
      paymentId: 'pay_1',
      subscriptionId: 'sub_wh',
      userId: 'usr_1',
      amount: 99,
      currency: 'USD',
      capturedAt: Date.now(),
      gateway: 'stripe',
    });

    await stream.drain();
    expect(dispatches).toHaveLength(0);

    // Now add the event to the allow-list
    consumer.setAllowedEvents(['billing.payment_captured']);

    await producer.publishPaymentCaptured({
      paymentId: 'pay_2',
      subscriptionId: 'sub_wh',
      userId: 'usr_1',
      amount: 150,
      currency: 'USD',
      capturedAt: Date.now(),
      gateway: 'stripe',
    });

    await stream.drain();
    stream.stop();

    expect(dispatches).toHaveLength(1);
  });

  it('handles sink errors gracefully', async () => {
    const faultySink: WebhookDispatchSink = {
      async dispatch() {
        throw new Error('webhook endpoint unreachable');
      },
    };
    const consumer = new WebhookDispatchConsumer(faultySink);
    const { bus, producer } = makeSetup();
    const stream = new BillingEventStream({ batchSize: 10, flushIntervalMs: 60_000 }, bus);
    stream.registerConsumer(consumer);
    stream.start();

    await producer.publishPaymentCaptured({
      paymentId: 'pay_fault',
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      amount: 99,
      currency: 'USD',
      capturedAt: Date.now(),
      gateway: 'stripe',
    });

    await expect(stream.drain()).resolves.toBeUndefined();
    stream.stop();

    // The stream-level error counter should be 0 — the consumer caught it internally
    expect(stream.getMetrics().errors).toBe(0);
  });
});
