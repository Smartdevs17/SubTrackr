import { describe, it, expect, beforeEach } from '@jest/globals';
import { PublicDataStore } from '../publicDataStore';

describe('PublicDataStore', () => {
  let store: PublicDataStore;

  beforeEach(() => {
    store = new PublicDataStore();
  });

  it('seeds default plans and pricing', () => {
    expect(store.listPlans().length).toBeGreaterThan(0);
    expect(store.listPricing().length).toBeGreaterThan(0);
  });

  it('updates and reads plans', () => {
    const updated = store.updatePlan('basic', { price: 6.99 });
    expect(updated?.price).toBe(6.99);
    expect(store.getPlan('basic')?.price).toBe(6.99);
  });

  it('returns null when updating unknown plan', () => {
    expect(store.updatePlan('missing', { price: 1 })).toBeNull();
  });

  it('updates public config', () => {
    store.updatePublicConfig('app/version', { latest: '9.9.9' });
    expect(store.getPublicConfigEntry('app/version')).toEqual({ latest: '9.9.9' });
  });

  it('stores feature overrides', () => {
    store.setFeatureOverride('feat-a', false);
    expect(store.getFeatureOverride('feat-a')).toBe(false);
  });

  it('reset restores defaults', () => {
    store.updatePlan('basic', { price: 99 });
    store.reset();
    expect(store.getPlan('basic')?.price).toBe(4.99);
  });
});
