/**
 * FallbackPricingStrategy Tests
 *
 * Validates that the fallback strategy safely handles unknown plan types
 * by returning the base price without failing.
 */

import { FallbackPricingStrategy } from '../domain/strategies/fallback-pricing.strategy';
import type { Plan, Subscriber, Usage } from '../domain/strategies/pricing-strategy.interface';

describe('FallbackPricingStrategy', () => {
  let strategy: FallbackPricingStrategy;

  const createPlan = (overrides?: Partial<Plan>): Plan => ({
    id: 'plan_unknown_1',
    typeCode: 'unknown-pricing-model',
    basePrice: 99.99,
    currency: 'USD',
    ...overrides,
  });

  const createUsage = (overrides?: Partial<Usage>): Usage => ({
    id: 'usage_1',
    unitsConsumed: 1000,
    seatCount: 10,
    ...overrides,
  });

  const createSubscriber = (overrides?: Partial<Subscriber>): Subscriber => ({
    id: 'sub_1',
    subscriptionId: 'sub_1',
    ...overrides,
  });

  beforeEach(() => {
    strategy = new FallbackPricingStrategy();
  });

  describe('basic fallback behavior', () => {
    it('returns base price regardless of usage', () => {
      const plan = createPlan({ basePrice: 50 });
      const usage = createUsage({ unitsConsumed: 5000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(50);
      expect(result.currency).toBe('USD');
    });

    it('returns base price regardless of seat count', () => {
      const plan = createPlan({ basePrice: 75 });
      const usage = createUsage({ seatCount: 100 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(75);
    });

    it('ignores custom configuration', () => {
      const plan = createPlan({
        basePrice: 30,
        config: {
          unknownField1: 'value1',
          unknownField2: 12345,
        },
      });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(30);
    });

    it('handles plans with no configuration', () => {
      const plan = createPlan({
        basePrice: 40,
        config: undefined,
      });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(40);
    });
  });

  describe('edge cases', () => {
    it('handles zero base price', () => {
      const plan = createPlan({ basePrice: 0 });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('handles negative base price by defaulting to zero', () => {
      const plan = createPlan({ basePrice: -50 });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('handles missing base price by defaulting to zero', () => {
      const plan = createPlan({ basePrice: undefined as any });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('handles non-numeric base price by defaulting to zero', () => {
      const plan = createPlan({ basePrice: 'invalid' as any });
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
    it('includes strategy marker in breakdown', () => {
      const plan = createPlan({ basePrice: 50 });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown?.strategy).toBe('fallback');
    });

    it('includes base price in breakdown', () => {
      const plan = createPlan({ basePrice: 75 });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.breakdown?.basePrice).toBe(75);
    });

    it('includes informational note in breakdown', () => {
      const plan = createPlan();
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.breakdown?.note).toContain('fallback');
      expect(result.breakdown?.note).toContain('unknown');
    });
  });

  describe('currency handling', () => {
    it('preserves USD currency', () => {
      const plan = createPlan({ currency: 'USD' });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.currency).toBe('USD');
    });

    it('preserves EUR currency', () => {
      const plan = createPlan({ currency: 'EUR' });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.currency).toBe('EUR');
    });

    it('preserves GBP currency', () => {
      const plan = createPlan({ currency: 'GBP' });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.currency).toBe('GBP');
    });
  });

  describe('validation', () => {
    it('throws error if plan is null', () => {
      expect(() => {
        strategy.calculate(createUsage(), null as any, createSubscriber());
      }).toThrow('plan object is required');
    });

    it('throws error if plan is undefined', () => {
      expect(() => {
        strategy.calculate(createUsage(), undefined as any, createSubscriber());
      }).toThrow('plan object is required');
    });

    it('throws error if currency is missing', () => {
      const plan = createPlan({ currency: '' });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('currency is required');
    });

    it('throws error if currency is null', () => {
      const plan = createPlan({ currency: null as any });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('currency is required');
    });
  });

  describe('strategy name', () => {
    it('returns human-readable fallback name', () => {
      expect(strategy.getName()).toContain('Fallback');
    });
  });

  describe('safe degradation', () => {
    it('never throws for valid plan and currency combination', () => {
      const plan = createPlan({
        typeCode: 'completely-unknown-type',
        basePrice: 123.45,
        currency: 'USD',
        config: {
          randomProperty: 'random-value',
          complexObject: { nested: { deeply: { value: 123 } } },
        },
      });

      // Should never throw
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).not.toThrow();
    });

    it('returns non-zero value for non-zero base price', () => {
      const plan = createPlan({ basePrice: 99.99 });
      const result = strategy.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBeGreaterThan(0);
    });

    it('returns zero value for zero or negative base price', () => {
      const plan1 = createPlan({ basePrice: 0 });
      const result1 = strategy.calculate(createUsage(), plan1, createSubscriber());
      expect(result1.value).toBe(0);

      const plan2 = createPlan({ basePrice: -100 });
      const result2 = strategy.calculate(createUsage(), plan2, createSubscriber());
      expect(result2.value).toBe(0);
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

    it('handles complex config without performance degradation', () => {
      const complexConfig: Record<string, any> = {};
      for (let i = 0; i < 100; i++) {
        complexConfig[`field${i}`] = Math.random();
      }

      const plan = createPlan({
        basePrice: 50,
        config: complexConfig,
      });
      const usage = createUsage();
      const subscriber = createSubscriber();

      const start = performance.now();
      strategy.calculate(usage, plan, subscriber);
      const duration = performance.now() - start;

      // Should still complete well under 5ms
      expect(duration).toBeLessThan(5);
    });
  });
});
