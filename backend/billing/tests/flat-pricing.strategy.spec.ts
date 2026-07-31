/**
 * FlatPricingStrategy Tests
 *
 * Validates that flat pricing correctly calculates a fixed amount
 * regardless of usage patterns.
 */

import { FlatPricingStrategy } from '../domain/strategies/flat-pricing.strategy';
import type { Plan, Subscriber, Usage } from '../domain/strategies/pricing-strategy.interface';

describe('FlatPricingStrategy', () => {
  let strategy: FlatPricingStrategy;

  const createPlan = (overrides?: Partial<Plan>): Plan => ({
    id: 'plan_flat_1',
    typeCode: 'flat',
    basePrice: 99.99,
    currency: 'USD',
    ...overrides,
  });

  const createUsage = (overrides?: Partial<Usage>): Usage => ({
    id: 'usage_1',
    unitsConsumed: 0,
    seatCount: 0,
    ...overrides,
  });

  const createSubscriber = (overrides?: Partial<Subscriber>): Subscriber => ({
    id: 'sub_1',
    subscriptionId: 'sub_1',
    ...overrides,
  });

  beforeEach(() => {
    strategy = new FlatPricingStrategy();
  });

  describe('basic pricing', () => {
    it('returns base price regardless of units consumed', () => {
      const plan = createPlan({ basePrice: 50 });
      const usage = createUsage({ unitsConsumed: 1000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(50);
      expect(result.currency).toBe('USD');
    });

    it('returns base price regardless of seat count', () => {
      const plan = createPlan({ basePrice: 100 });
      const usage = createUsage({ seatCount: 50 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(100);
      expect(result.currency).toBe('USD');
    });

    it('returns correct currency', () => {
      const plan = createPlan({ basePrice: 75.5, currency: 'EUR' });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.currency).toBe('EUR');
    });
  });

  describe('edge cases', () => {
    it('handles zero base price', () => {
      const plan = createPlan({ basePrice: 0 });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('rounds to 2 decimal places', () => {
      const plan = createPlan({ basePrice: 19.999 });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(20);
    });

    it('handles high precision values', () => {
      const plan = createPlan({ basePrice: 10.123456 });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(10.12);
    });
  });

  describe('breakdown', () => {
    it('includes basePrice in breakdown', () => {
      const plan = createPlan({ basePrice: 25 });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown?.basePrice).toBe(25);
    });
  });

  describe('validation', () => {
    it('throws error if plan is null', () => {
      expect(() => {
        strategy.calculate(createUsage(), null as any, createSubscriber());
      }).toThrow('Invalid plan');
    });

    it('throws error if basePrice is negative', () => {
      const plan = createPlan({ basePrice: -10 });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('basePrice must be a non-negative number');
    });

    it('throws error if basePrice is not a number', () => {
      const plan = createPlan({ basePrice: 'invalid' as any });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('basePrice must be a non-negative number');
    });

    it('throws error if currency is missing', () => {
      const plan = createPlan({ currency: '' });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('currency is required');
    });
  });

  describe('strategy name', () => {
    it('returns human-readable name', () => {
      expect(strategy.getName()).toBe('Flat Pricing');
    });
  });

  describe('performance', () => {
    it('completes calculation in reasonable time', () => {
      const plan = createPlan();
      const usage = createUsage();
      const subscriber = createSubscriber();

      const start = performance.now();
      strategy.calculate(usage, plan, subscriber);
      const duration = performance.now() - start;

      // Should complete well under 5ms
      expect(duration).toBeLessThan(5);
    });
  });
});
