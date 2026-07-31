import { expect, describe, it } from '@jest/globals';
import { SubscriptionCRDT, CRDTSubscriptionState } from '../crdt';
import { Subscription, SubscriptionCategory, BillingCycle } from '../../../types/subscription';

const mockSubscription = (
  id: string,
  name: string,
  price: number,
  updatedAt: Date
): Subscription => ({
  id,
  name,
  price,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  category: SubscriptionCategory.STREAMING,
  nextBillingDate: new Date('2026-07-01T00:00:00Z'),
  isActive: true,
  notificationsEnabled: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-06-01T00:00:00Z'),
  updatedAt,
});

describe('SubscriptionCRDT', () => {
  it('creates metadata with correct timestamps', () => {
    const sub = mockSubscription('sub-1', 'Netflix', 15, new Date('2026-06-28T09:00:00Z'));
    const meta = SubscriptionCRDT.createMetadata(sub, 1000);

    expect(meta.timestamps.name).toBe(1000);
    expect(meta.timestamps.price).toBe(1000);
    expect(meta.deletedAt).toBeUndefined();
  });

  it('updates metadata with newer timestamps for updated fields', () => {
    const sub = mockSubscription('sub-1', 'Netflix', 15, new Date('2026-06-28T09:00:00Z'));
    const meta = SubscriptionCRDT.createMetadata(sub, 1000);

    const updatedMeta = SubscriptionCRDT.updateMetadata(meta, { price: 16 }, 2000);
    expect(updatedMeta.timestamps.price).toBe(2000);
    expect(updatedMeta.timestamps.name).toBe(1000);
  });

  it('merges two divergent states using field-level LWW', () => {
    const subA = mockSubscription('sub-1', 'Netflix A', 15, new Date('2026-06-28T09:00:00Z'));
    const metaA = {
      timestamps: { name: 1000, price: 1000 },
    };

    const subB = mockSubscription('sub-1', 'Netflix B', 18, new Date('2026-06-28T09:00:00Z'));
    const metaB = {
      timestamps: { name: 2000, price: 500 },
    };

    const stateA: CRDTSubscriptionState = {
      subscriptions: { 'sub-1': subA },
      metadata: { 'sub-1': metaA },
    };

    const stateB: CRDTSubscriptionState = {
      subscriptions: { 'sub-1': subB },
      metadata: { 'sub-1': metaB },
    };

    const merged = SubscriptionCRDT.merge(stateA, stateB);
    const mergedSub = merged.subscriptions['sub-1'];
    const mergedMeta = merged.metadata['sub-1'];

    expect(mergedSub.name).toBe('Netflix B');
    expect(mergedSub.price).toBe(15);
    expect(mergedMeta.timestamps.name).toBe(2000);
    expect(mergedMeta.timestamps.price).toBe(1000);
  });

  it('handles tombstones: deletion overrides updates if deletedAt >= max field timestamp', () => {
    const sub = mockSubscription('sub-1', 'Netflix', 15, new Date());
    const stateA: CRDTSubscriptionState = {
      subscriptions: { 'sub-1': sub },
      metadata: {
        'sub-1': {
          timestamps: { name: 1000, price: 1000 },
        },
      },
    };

    const stateB: CRDTSubscriptionState = {
      subscriptions: {},
      metadata: {
        'sub-1': {
          timestamps: { name: 1000, price: 1000 },
          deletedAt: 1500,
        },
      },
    };

    const merged = SubscriptionCRDT.merge(stateA, stateB);
    expect(merged.subscriptions['sub-1']).toBeUndefined();
    expect(merged.metadata['sub-1'].deletedAt).toBe(1500);
  });

  it('handles tombstones: update overrides deletion if updated field is newer than deletedAt', () => {
    const sub = mockSubscription('sub-1', 'Netflix Updated', 20, new Date());
    const stateA: CRDTSubscriptionState = {
      subscriptions: { 'sub-1': sub },
      metadata: {
        'sub-1': {
          timestamps: { name: 2000, price: 2000 },
        },
      },
    };

    const stateB: CRDTSubscriptionState = {
      subscriptions: {},
      metadata: {
        'sub-1': {
          timestamps: { name: 1000, price: 1000 },
          deletedAt: 1500,
        },
      },
    };

    const merged = SubscriptionCRDT.merge(stateA, stateB);
    expect(merged.subscriptions['sub-1']).toBeDefined();
    expect(merged.subscriptions['sub-1'].name).toBe('Netflix Updated');
    expect(merged.metadata['sub-1'].deletedAt).toBe(1500);
  });

  it('is commutative, associative, and idempotent', () => {
    const subA = mockSubscription('sub-1', 'Netflix A', 15, new Date());
    const subB = mockSubscription('sub-1', 'Netflix B', 18, new Date());
    const subC = mockSubscription('sub-1', 'Netflix C', 20, new Date());

    const stateA: CRDTSubscriptionState = {
      subscriptions: { 'sub-1': subA },
      metadata: { 'sub-1': { timestamps: { name: 1000, price: 1000 } } },
    };

    const stateB: CRDTSubscriptionState = {
      subscriptions: { 'sub-1': subB },
      metadata: { 'sub-1': { timestamps: { name: 2000, price: 500 } } },
    };

    const stateC: CRDTSubscriptionState = {
      subscriptions: { 'sub-1': subC },
      metadata: { 'sub-1': { timestamps: { name: 1500, price: 1500 } } },
    };

    const mergeAB = SubscriptionCRDT.merge(stateA, stateB);
    const mergeBA = SubscriptionCRDT.merge(stateB, stateA);
    expect(mergeAB).toEqual(mergeBA);

    const mergeAA = SubscriptionCRDT.merge(stateA, stateA);
    expect(mergeAA.subscriptions['sub-1'].name).toBe(stateA.subscriptions['sub-1'].name);

    const mergeAB_C = SubscriptionCRDT.merge(mergeAB, stateC);
    const mergeBC = SubscriptionCRDT.merge(stateB, stateC);
    const mergeA_BC = SubscriptionCRDT.merge(stateA, mergeBC);
    expect(mergeAB_C).toEqual(mergeA_BC);
  });
});
