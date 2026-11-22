/**
 * UsageBasedPricingStrategy Tests
 *
 * Validates that usage-based pricing correctly calculates charges
 * based on units consumed, accounting for included units.
 */

import { UsageBasedPricingStrategy } from '../domain/strategies/usage-based-pricing.strategy';
import type { Plan, Subscriber, Usage } from '../domain/strategies/pricing-strategy.interface';

describe('UsageBasedPricingStrategy', () => {
  let strategy: UsageBasedPricingStrategy;

  const createPlan = (overrides?: Partial<Plan>): Plan => ({
    id: 'plan_usage_1',
    typeCode: 'usage-based',
    basePrice: 0,
    currency: 'USD',
    config: {
      unitPrice: 0.05,
      includedUnits: 0,
    },
    ...overrides,
  });

  const createUsage = (overrides?: Partial<Usage>): Usage => ({
    id: 'usage_1',
    unitsConsumed: 1000,
    seatCount: 0,
    ...overrides,
  });

  const createSubscriber = (overrides?: Partial<Subscriber>): Subscriber => ({
    id: 'sub_1',
    subscriptionId: 'sub_1',
    ...overrides,
  });

  beforeEach(() => {
    strategy = new UsageBasedPricingStrategy();
  });

  describe('basic pricing', () => {
    it('multiplies unit price by units consumed', () => {
      const plan = createPlan({
        config: { unitPrice: 0.05, includedUnits: 0 },
      });
      const usage = createUsage({ unitsConsumed: 1000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(50);
      expect(result.currency).toBe('USD');
    });

    it('handles small unit prices', () => {
      const plan = createPlan({
        config: { unitPrice: 0.001, includedUnits: 0 },
      });
      const usage = createUsage({ unitsConsumed: 5000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(5);
    });

    it('handles large unit counts', () => {
      const plan = createPlan({
        config: { unitPrice: 0.01, includedUnits: 0 },
      });
      const usage = createUsage({ unitsConsumed: 100000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(1000);
    });
  });

  describe('included units', () => {
    it('deducts included units from billable units', () => {
      const plan = createPlan({
        config: { unitPrice: 0.1, includedUnits: 100 },
      });
      const usage = createUsage({ unitsConsumed: 500 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      // 500 - 100 = 400 billable units * 0.1 = 40
      expect(result.value).toBe(40);
    });

    it('returns zero if usage is within included units', () => {
      const plan = createPlan({
        config: { unitPrice: 0.1, includedUnits: 1000 },
      });
      const usage = createUsage({ unitsConsumed: 500 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('returns zero if usage exactly matches included units', () => {
      const plan = createPlan({
        config: { unitPrice: 0.1, includedUnits: 1000 },
      });
      const usage = createUsage({ unitsConsumed: 1000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('handles large included unit counts', () => {
      const plan = createPlan({
        config: { unitPrice: 0.05, includedUnits: 1000000 },
      });
      const usage = createUsage({ unitsConsumed: 1000500 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(25);
    });
  });

  describe('edge cases', () => {
    it('handles zero units consumed', () => {
      const plan = createPlan({
        config: { unitPrice: 0.1, includedUnits: 0 },
      });
      const usage = createUsage({ unitsConsumed: 0 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('handles zero unit price', () => {
      const plan = createPlan({
        config: { unitPrice: 0, includedUnits: 0 },
      });
      const usage = createUsage({ unitsConsumed: 10000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('rounds to 2 decimal places', () => {
      const plan = createPlan({
        config: { unitPrice: 0.03, includedUnits: 0 },
      });
      const usage = createUsage({ unitsConsumed: 100 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(3);
    });

    it('handles high precision calculations', () => {
      const plan = createPlan({
        config: { unitPrice: 0.123, includedUnits: 0 },
      });
      const usage = createUsage({ unitsConsumed: 100 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(12.3);
    });
  });

  describe('breakdown', () => {
    it('includes unitPrice, unitsConsumed, includedUnits, billableUnits, and total', () => {
      const plan = createPlan({
        config: { unitPrice: 0.05, includedUnits: 50 },
      });
      const usage = createUsage({ unitsConsumed: 500 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown?.unitPrice).toBe(0.05);
      expect(result.breakdown?.unitsConsumed).toBe(500);
      expect(result.breakdown?.includedUnits).toBe(50);
      expect(result.breakdown?.billableUnits).toBe(450);
      expect(result.breakdown?.total).toBe(22.5);
    });
  });

  describe('validation', () => {
    it('throws error if plan config is missing', () => {
      const plan = createPlan({ config: undefined });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('config is required');
    });

    it('throws error if unitPrice is missing', () => {
      const plan = createPlan({
        config: { includedUnits: 0 },
      });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('unitPrice must be a non-negative number');
    });

    it('throws error if unitPrice is negative', () => {
      const plan = createPlan({
        config: { unitPrice: -0.05, includedUnits: 0 },
      });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('unitPrice must be a non-negative number');
    });

    it('throws error if currency is missing', () => {
      const plan = createPlan({ currency: '' });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('currency is required');
    });

    it('throws error if usage is null', () => {
      const plan = createPlan();
      expect(() => {
        strategy.calculate(null as any, plan, createSubscriber());
      }).toThrow('Invalid usage');
    });

    it('throws error if unitsConsumed is negative', () => {
      const plan = createPlan();
      const usage = createUsage({ unitsConsumed: -100 });
      expect(() => {
        strategy.calculate(usage, plan, createSubscriber());
      }).toThrow('unitsConsumed must be a non-negative number');
    });
  });

  describe('strategy name', () => {
    it('returns human-readable name', () => {
      expect(strategy.getName()).toBe('Usage-Based Pricing');
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
