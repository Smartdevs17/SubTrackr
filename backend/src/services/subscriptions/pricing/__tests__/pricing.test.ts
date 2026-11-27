/**
 * Unit tests for the pricing module.
 *
 * Covers: errors, strategies, proration, and plan cache.
 * No I/O — all services are tested in isolation.
 */

import { PricingError, PricingErrorCode } from '../errors';
import {
  FlatRateStrategy,
  PerSeatStrategy,
  UsageBasedStrategy,
  TieredStrategy,
  StrategyRegistry,
} from '../pricingStrategies';
import { ProrationService } from '../prorationService';
import { InMemoryPlanCache } from '../planCacheService';
import type { PlanTemplate } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlan(planId: string): PlanTemplate {
  return {
    planId,
    name: `Plan ${planId}`,
    description: 'test plan',
    interval: 'monthly',
    currency: 'USD',
    basePrice: 9.99,
    trialDays: 14,
    features: [],
    metadata: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

// ── Error codes ───────────────────────────────────────────────────────────────

describe('PricingError', () => {
  it('all error codes are unique', () => {
    const codes = Object.values(PricingErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('planNotFound carries planId in details', () => {
    const err = PricingError.planNotFound('plan_basic');
    expect(err.code).toBe(PricingErrorCode.PLAN_NOT_FOUND);
    expect(err.details).toMatchObject({ planId: 'plan_basic' });
    expect(err).toBeInstanceOf(PricingError);
  });

  it('strategyNotFound carries name in details', () => {
    const err = PricingError.strategyNotFound('dynamic');
    expect(err.code).toBe(PricingErrorCode.STRATEGY_NOT_FOUND);
    expect(err.details.name).toBe('dynamic');
  });

  it('prorationFailed carries subscriptionId and reason', () => {
    const err = PricingError.prorationFailed('sub_1', 'period expired');
    expect(err.code).toBe(PricingErrorCode.PRORATION_FAILED);
    expect(err.details).toMatchObject({ subscriptionId: 'sub_1', reason: 'period expired' });
  });
});

// ── FlatRateStrategy ──────────────────────────────────────────────────────────

describe('FlatRateStrategy', () => {
  const strategy = new FlatRateStrategy();

  it('returns base price unchanged', () => {
    const result = strategy.calculate({ basePrice: 9.99, currency: 'USD' });
    expect(result.amount).toBe(9.99);
    expect(result.currency).toBe('USD');
    expect(result.breakdown).toHaveLength(1);
  });

  it('defaults currency to USD when omitted', () => {
    expect(strategy.calculate({ basePrice: 5 }).currency).toBe('USD');
  });
});

// ── PerSeatStrategy ───────────────────────────────────────────────────────────

describe('PerSeatStrategy', () => {
  const strategy = new PerSeatStrategy();

  it('multiplies base price by seat count', () => {
    const result = strategy.calculate({ basePrice: 10, quantity: 5 });
    expect(result.amount).toBe(50);
    expect(result.breakdown).toHaveLength(2);
  });

  it('defaults to 1 seat when quantity is omitted', () => {
    expect(strategy.calculate({ basePrice: 10 }).amount).toBe(10);
  });

  it('uses at least 1 seat when quantity is 0', () => {
    expect(strategy.calculate({ basePrice: 10, quantity: 0 }).amount).toBe(10);
  });
});

// ── UsageBasedStrategy ────────────────────────────────────────────────────────

describe('UsageBasedStrategy', () => {
  it('charges base + (units × pricePerUnit)', () => {
    const strategy = new UsageBasedStrategy(0.05);
    const result = strategy.calculate({ basePrice: 5, usageUnits: 100 });
    expect(result.amount).toBeCloseTo(10); // 5 + 100 * 0.05
  });

  it('charges only base when there is no usage', () => {
    const strategy = new UsageBasedStrategy(0.1);
    expect(strategy.calculate({ basePrice: 3 }).amount).toBe(3);
  });

  it('never returns a negative amount', () => {
    const strategy = new UsageBasedStrategy(0.01);
    const result = strategy.calculate({ basePrice: 0, usageUnits: -50 });
    expect(result.amount).toBeGreaterThanOrEqual(0);
  });
});

// ── TieredStrategy ────────────────────────────────────────────────────────────

describe('TieredStrategy', () => {
  const tiers = [
    { upTo: 100, unitPrice: 0.1 },
    { upTo: null, unitPrice: 0.05 },
  ];
  const strategy = new TieredStrategy(tiers);

  it('applies only the first tier when usage fits within it', () => {
    const result = strategy.calculate({ basePrice: 0, usageUnits: 50 });
    expect(result.amount).toBeCloseTo(5); // 50 * 0.1
  });

  it('spans multiple tiers correctly', () => {
    const result = strategy.calculate({ basePrice: 0, usageUnits: 150 });
    // 100 * 0.1 = 10, 50 * 0.05 = 2.5
    expect(result.amount).toBeCloseTo(12.5);
  });

  it('adds base fee on top of tiered usage', () => {
    const result = strategy.calculate({ basePrice: 5, usageUnits: 100 });
    expect(result.amount).toBeCloseTo(15); // 5 + 10
  });

  it('returns base only when usageUnits is 0', () => {
    expect(strategy.calculate({ basePrice: 3, usageUnits: 0 }).amount).toBe(3);
  });
});

// ── StrategyRegistry ──────────────────────────────────────────────────────────

describe('StrategyRegistry', () => {
  it('resolves all four built-in strategies', () => {
    const registry = new StrategyRegistry();
    expect(registry.resolve('flat_rate')).toBeInstanceOf(FlatRateStrategy);
    expect(registry.resolve('per_seat')).toBeInstanceOf(PerSeatStrategy);
    expect(registry.resolve('usage_based')).toBeInstanceOf(UsageBasedStrategy);
    expect(registry.resolve('tiered')).toBeInstanceOf(TieredStrategy);
  });

  it('throws PricingError for an unknown strategy name', () => {
    const registry = new StrategyRegistry();
    expect(() => registry.resolve('nonexistent')).toThrow(PricingError);
    expect(() => registry.resolve('nonexistent')).toThrow(expect.objectContaining({
      code: PricingErrorCode.STRATEGY_NOT_FOUND,
    }));
  });

  it('allows registering and resolving a custom strategy', () => {
    const registry = new StrategyRegistry();
    const custom = {
      name: 'custom',
      calculate: jest.fn().mockReturnValue({ amount: 1, currency: 'USD', breakdown: [] }),
    };
    registry.register(custom);
    expect(registry.resolve('custom')).toBe(custom);
    expect(registry.list()).toContain('custom');
  });
});

// ── ProrationService ──────────────────────────────────────────────────────────

describe('ProrationService', () => {
  const service = new ProrationService();

  // 31-day period: Jan 1 → Feb 1, change happens on Jan 16 (15 days used, 16 remaining)
  const periodStart = new Date('2026-01-01T00:00:00Z').getTime();
  const periodEnd   = new Date('2026-02-01T00:00:00Z').getTime();
  const changeAt    = new Date('2026-01-16T00:00:00Z').getTime();

  it('credits unused days at old plan rate', () => {
    const result = service.calculate({
      subscriptionId: 'sub_1',
      currentPrice: 31,  // $1/day over 31-day period
      newPrice: 62,      // $2/day
      currency: 'USD',
      periodStart,
      periodEnd,
      changeAt,
    });
    expect(result.proratedDays).toBe(16);
    expect(result.unusedCredit).toBeCloseTo(16, 0);
    expect(result.newPlanCharge).toBeCloseTo(32, 0);
    expect(result.netAmount).toBeCloseTo(16, 0);
    expect(result.currency).toBe('USD');
  });

  it('returns netAmount of 0 when both plans cost the same', () => {
    const result = service.calculate({
      subscriptionId: 'sub_2',
      currentPrice: 30,
      newPrice: 30,
      currency: 'USD',
      periodStart,
      periodEnd,
      changeAt,
    });
    expect(result.netAmount).toBe(0);
  });

  it('returns a negative net when downgrading', () => {
    const result = service.calculate({
      subscriptionId: 'sub_3',
      currentPrice: 60,
      newPrice: 30,
      currency: 'USD',
      periodStart,
      periodEnd,
      changeAt,
    });
    expect(result.netAmount).toBeLessThan(0);
  });

  it('throws when periodEnd is before periodStart', () => {
    expect(() =>
      service.calculate({
        subscriptionId: 'sub_4',
        currentPrice: 10,
        newPrice: 20,
        currency: 'USD',
        periodStart: periodEnd,
        periodEnd: periodStart,
      }),
    ).toThrow(PricingError);
  });

  it('throws when subscriptionId is empty', () => {
    expect(() =>
      service.calculate({
        subscriptionId: '',
        currentPrice: 10,
        newPrice: 20,
        currency: 'USD',
        periodStart,
        periodEnd,
      }),
    ).toThrow(PricingError);
  });

  it('throws when changeAt is after periodEnd', () => {
    expect(() =>
      service.calculate({
        subscriptionId: 'sub_5',
        currentPrice: 10,
        newPrice: 20,
        currency: 'USD',
        periodStart,
        periodEnd,
        changeAt: periodEnd + 86_400_000,
      }),
    ).toThrow(PricingError);
  });
});

// ── InMemoryPlanCache ─────────────────────────────────────────────────────────

describe('InMemoryPlanCache', () => {
  it('stores and retrieves a plan by id', () => {
    const cache = new InMemoryPlanCache();
    const plan = makePlan('basic');
    cache.set('basic', plan);
    expect(cache.get('basic')).toStrictEqual(plan);
    expect(cache.size()).toBe(1);
  });

  it('returns undefined for a key that was never set', () => {
    const cache = new InMemoryPlanCache();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('invalidate removes a single entry', () => {
    const cache = new InMemoryPlanCache();
    cache.set('basic', makePlan('basic'));
    cache.invalidate('basic');
    expect(cache.get('basic')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('invalidateAll clears all entries', () => {
    const cache = new InMemoryPlanCache();
    cache.set('a', makePlan('a'));
    cache.set('b', makePlan('b'));
    cache.invalidateAll();
    expect(cache.size()).toBe(0);
  });

  it('evicts the oldest entry when maxSize is exceeded', () => {
    const cache = new InMemoryPlanCache(2);
    cache.set('a', makePlan('a'));
    cache.set('b', makePlan('b'));
    cache.set('c', makePlan('c')); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeDefined();
    expect(cache.size()).toBe(2);
  });

  it('updating an existing key does not trigger eviction', () => {
    const cache = new InMemoryPlanCache(2);
    cache.set('a', makePlan('a'));
    cache.set('b', makePlan('b'));
    cache.set('a', makePlan('a')); // update, not new
    expect(cache.size()).toBe(2);
    expect(cache.get('b')).toBeDefined();
  });
});
