/**
 * Tests for SubscriptionEventBus
 *
 * Covers:
 *  - Typed publish for every lifecycle event type
 *  - Persistence to SubscriptionEventStore on publish
 *  - skipPersist option
 *  - Handler is called with the published event
 *  - on() / onAny() subscriptions
 *  - replay() iterates stored events in sequence order
 *  - replayToBus() re-publishes to live handlers
 *  - Dead-letter queue captures handler errors
 *  - getMetrics() returns accurate counts
 *  - Default singleton export
 */

import {
  SubscriptionEventBus,
  subscriptionEventBus,
  type SubscriptionLifecycleEventName,
} from '../subscriptionEventBus';
import { SubscriptionEventStore } from '../subscriptionEventStore';
import { EventBus } from '../../shared/events';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(): SubscriptionEventStore {
  return new SubscriptionEventStore();
}

function makeBus(): { eventBus: EventBus; store: SubscriptionEventStore; sub: SubscriptionEventBus } {
  const eventBus = new EventBus();
  const store = makeStore();
  const sub = new SubscriptionEventBus(eventBus, store);
  return { eventBus, store, sub };
}

const BASE_CREATED_PAYLOAD = {
  subscriptionId: 'sub_001',
  userId: 'usr_001',
  planId: 'plan_pro',
  status: 'active',
  billingCycle: 'monthly',
  nextBillingDate: Date.now() + 30 * 86_400_000,
};

const BASE_CANCELLED_PAYLOAD = {
  subscriptionId: 'sub_001',
  userId: 'usr_001',
  reason: 'too expensive',
  cancelledAt: Date.now(),
  effectiveAt: Date.now() + 86_400_000,
};

// ---------------------------------------------------------------------------
// Core publish / subscribe
// ---------------------------------------------------------------------------

describe('SubscriptionEventBus', () => {
  describe('publish()', () => {
    it('calls registered handler with the published event', async () => {
      const { sub } = makeBus();
      const received: unknown[] = [];

      sub.on('subscription.created', (evt) => { received.push(evt); });
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);

      expect(received).toHaveLength(1);
      const evt = received[0] as { name: string; payload: typeof BASE_CREATED_PAYLOAD };
      expect(evt.name).toBe('subscription.created');
      expect(evt.payload.subscriptionId).toBe('sub_001');
    });

    it('persists the event to the store by default', async () => {
      const { store, sub } = makeBus();
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);

      const page = store.query({ subscriptionId: 'sub_001' });
      expect(page.events).toHaveLength(1);
      expect(page.events[0].type).toBe('subscription.created');
    });

    it('does not persist when skipPersist is true', async () => {
      const { store, sub } = makeBus();
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD, { skipPersist: true });

      const page = store.query({ subscriptionId: 'sub_001' });
      expect(page.events).toHaveLength(0);
    });

    it('increments published counter but NOT persisted when skipPersist', async () => {
      const { sub } = makeBus();
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD, { skipPersist: true });

      const metrics = sub.getMetrics();
      expect(metrics.published).toBe(1);
      expect(metrics.persisted).toBe(0);
    });

    it('stores the event with the subscriptionId as aggregateId', async () => {
      const { store, sub } = makeBus();
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);

      const page = store.query({ subscriptionId: 'sub_001' });
      expect(page.events[0].subscriptionId).toBe('sub_001');
    });
  });

  // ── All lifecycle event types ─────────────────────────────────────────────

  describe('all lifecycle event types', () => {
    const cases: Array<[SubscriptionLifecycleEventName, Record<string, unknown>]> = [
      ['subscription.created', BASE_CREATED_PAYLOAD],
      ['subscription.cancelled', BASE_CANCELLED_PAYLOAD],
      ['subscription.renewed', {
        subscriptionId: 'sub_002',
        userId: 'usr_002',
        planId: 'plan_pro',
        renewedAt: Date.now(),
        nextBillingDate: Date.now() + 30 * 86_400_000,
        amount: 29_99,
        currency: 'USD',
      }],
      ['subscription.upgraded', {
        subscriptionId: 'sub_003',
        userId: 'usr_003',
        fromPlanId: 'plan_basic',
        toPlanId: 'plan_pro',
        effectiveAt: Date.now(),
        proratedCredit: 5_00,
      }],
      ['subscription.paused', {
        subscriptionId: 'sub_004',
        userId: 'usr_004',
        pausedAt: Date.now(),
        resumeAt: Date.now() + 7 * 86_400_000,
      }],
      ['subscription.resumed', {
        subscriptionId: 'sub_005',
        userId: 'usr_005',
        resumedAt: Date.now(),
      }],
      ['subscription.payment_failed', {
        subscriptionId: 'sub_006',
        userId: 'usr_006',
        attemptNumber: 2,
        nextRetryAt: Date.now() + 3 * 86_400_000,
        reason: 'card_declined',
      }],
    ];

    test.each(cases)('publish(%s) calls handler', async (name, payload) => {
      const { sub } = makeBus();
      const received: string[] = [];

      sub.on(name, (evt) => { received.push(evt.name); });
      await sub.publish(name, payload as never);

      expect(received).toEqual([name]);
    });

    test.each(cases)('publish(%s) persists to store', async (name, payload) => {
      const { store, sub } = makeBus();
      const subId = (payload as { subscriptionId: string }).subscriptionId;

      await sub.publish(name, payload as never);
      const page = store.query({ subscriptionId: subId });

      expect(page.events).toHaveLength(1);
    });
  });

  // ── onAny ─────────────────────────────────────────────────────────────────

  describe('onAny()', () => {
    it('receives all lifecycle events', async () => {
      const { sub } = makeBus();
      const names: string[] = [];

      sub.onAny((evt) => { names.push(evt.name); });
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);
      await sub.publish('subscription.cancelled', { ...BASE_CANCELLED_PAYLOAD, subscriptionId: 'sub_007', userId: 'usr_007' });

      expect(names).toEqual(['subscription.created', 'subscription.cancelled']);
    });
  });

  // ── Subscription unsubscribe ───────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('stops calling handler after unsubscribe()', async () => {
      const { sub } = makeBus();
      const received: unknown[] = [];

      const subscription = sub.on('subscription.created', (evt) => { received.push(evt); });
      subscription.unsubscribe();

      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);
      expect(received).toHaveLength(0);
    });
  });

  // ── replay() ──────────────────────────────────────────────────────────────

  describe('replay()', () => {
    it('delivers stored events in sequence order to the handler', async () => {
      const { store, sub } = makeBus();

      // Append events directly to the store (bypassing publish)
      store.append({ subscriptionId: 'sub_r', type: 'subscription.created', payload: { subscriptionId: 'sub_r' } });
      store.append({ subscriptionId: 'sub_r', type: 'subscription.renewed', payload: { subscriptionId: 'sub_r' } });

      const types: string[] = [];
      await sub.replay('sub_r', (evt) => { types.push(evt.type); });

      expect(types).toEqual(['subscription.created', 'subscription.renewed']);
    });

    it('does not deliver events for a different subscription', async () => {
      const { store, sub } = makeBus();

      store.append({ subscriptionId: 'sub_A', type: 'subscription.created', payload: {} });
      store.append({ subscriptionId: 'sub_B', type: 'subscription.cancelled', payload: {} });

      const types: string[] = [];
      await sub.replay('sub_A', (evt) => { types.push(evt.type); });

      expect(types).toEqual(['subscription.created']);
    });

    it('increments replayed counter', async () => {
      const { store, sub } = makeBus();
      store.append({ subscriptionId: 'sub_cnt', type: 'subscription.created', payload: {} });
      store.append({ subscriptionId: 'sub_cnt', type: 'subscription.renewed', payload: {} });

      await sub.replay('sub_cnt', () => {});
      expect(sub.getMetrics().replayed).toBe(2);
    });
  });

  // ── replayToBus() ─────────────────────────────────────────────────────────

  describe('replayToBus()', () => {
    it('re-publishes stored events to live handlers', async () => {
      const { sub } = makeBus();
      const received: string[] = [];

      // Publish first to populate the store
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);

      // Attach a new handler AFTER the initial publish
      sub.on('subscription.created', (evt) => { received.push(evt.name); });

      const count = await sub.replayToBus('sub_001');
      expect(count).toBe(1);
      expect(received).toEqual(['subscription.created']);
    });

    it('does not double-persist during replayToBus', async () => {
      const { store, sub } = makeBus();
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);

      const before = store.query({ subscriptionId: 'sub_001' }).events.length;
      await sub.replayToBus('sub_001');
      const after = store.query({ subscriptionId: 'sub_001' }).events.length;

      expect(after).toBe(before);
    });
  });

  // ── Dead-letter queue ─────────────────────────────────────────────────────

  describe('dead-letter queue', () => {
    it('captures handler errors in the dead-letter queue', async () => {
      const eventBus = new EventBus();
      const sub = new SubscriptionEventBus(eventBus, makeStore());

      sub.on('subscription.created', () => { throw new Error('handler boom'); });
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);

      const entries = sub.getDeadLetterEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].error).toContain('handler boom');
    });

    it('clearDeadLetter() empties the queue', async () => {
      const eventBus = new EventBus();
      const sub = new SubscriptionEventBus(eventBus, makeStore());

      sub.on('subscription.created', () => { throw new Error('fail'); });
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);

      sub.clearDeadLetter();
      expect(sub.getDeadLetterEntries()).toHaveLength(0);
    });

    it('increments handlerErrors counter', async () => {
      const eventBus = new EventBus();
      const sub = new SubscriptionEventBus(eventBus, makeStore());

      sub.on('subscription.created', () => { throw new Error('fail'); });
      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);

      expect(sub.getMetrics().handlerErrors).toBe(1);
    });
  });

  // ── getMetrics() ──────────────────────────────────────────────────────────

  describe('getMetrics()', () => {
    it('tracks published count per event type', async () => {
      const { sub } = makeBus();

      await sub.publish('subscription.created', BASE_CREATED_PAYLOAD);
      await sub.publish('subscription.created', { ...BASE_CREATED_PAYLOAD, subscriptionId: 'sub_x', userId: 'usr_x' });
      await sub.publish('subscription.cancelled', BASE_CANCELLED_PAYLOAD);

      const metrics = sub.getMetrics();
      expect(metrics.countByType['subscription.created']).toBe(2);
      expect(metrics.countByType['subscription.cancelled']).toBe(1);
      expect(metrics.published).toBe(3);
    });

    it('returns zero counts initially', () => {
      const { sub } = makeBus();
      const metrics = sub.getMetrics();

      for (const count of Object.values(metrics.countByType)) {
        expect(count).toBe(0);
      }
      expect(metrics.published).toBe(0);
      expect(metrics.persisted).toBe(0);
    });
  });

  // ── Default singleton ─────────────────────────────────────────────────────

  describe('subscriptionEventBus singleton', () => {
    it('is a SubscriptionEventBus instance', () => {
      expect(subscriptionEventBus).toBeInstanceOf(SubscriptionEventBus);
    });
  });
});
