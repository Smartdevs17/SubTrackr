/**
 * TieredPricingStrategy Tests
 *
 * Validates that tiered pricing correctly distributes usage across
 * multiple price tiers with different rates.
 */

import { TieredPricingStrategy } from '../domain/strategies/tiered-pricing.strategy';
import type { Plan, Subscriber, Usage, PricingTier } from '../domain/strategies';

describe('TieredPricingStrategy', () => {
  let strategy: TieredPricingStrategy;

  const createPlan = (overrides?: Partial<Plan>): Plan => ({
    id: 'plan_tiered_1',
    typeCode: 'tiered',
    basePrice: 0,
    currency: 'USD',
    config: {
      tiers: [
        { upToUnits: 100, unitPrice: 0 },
        { upToUnits: 1000, unitPrice: 0.01 },
        { upToUnits: null, unitPrice: 0.005 },
      ],
    },
    ...overrides,
  });

  const createUsage = (overrides?: Partial<Usage>): Usage => ({
    id: 'usage_1',
    unitsConsumed: 500,
    seatCount: 0,
    ...overrides,
  });

  const createSubscriber = (overrides?: Partial<Subscriber>): Subscriber => ({
    id: 'sub_1',
    subscriptionId: 'sub_1',
    ...overrides,
  });

  beforeEach(() => {
    strategy = new TieredPricingStrategy();
  });

  describe('basic tiered pricing', () => {
    it('distributes usage across tiers correctly', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 100, unitPrice: 0 },
        { upToUnits: 1000, unitPrice: 0.01 },
        { upToUnits: null, unitPrice: 0.005 },
      ];
      const plan = createPlan({
        config: { tiers },
      });
      const usage = createUsage({ unitsConsumed: 500 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      // First 100 units free, next 400 units at $0.01 = $4
      expect(result.value).toBe(4);
    });

    it('handles usage within first tier', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 100, unitPrice: 0 },
        { upToUnits: null, unitPrice: 0.1 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 50 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('handles usage spanning multiple tiers', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 100, unitPrice: 0 },
        { upToUnits: 1000, unitPrice: 0.01 },
        { upToUnits: null, unitPrice: 0.005 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 2000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      // 0-100: free, 100-1000: 900*0.01=$9, 1000-2000: 1000*0.005=$5
      expect(result.value).toBe(14);
    });
  });

  describe('unbounded tiers', () => {
    it('handles unbounded final tier with null upToUnits', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 100, unitPrice: 0.1 },
        { upToUnits: null, unitPrice: 0.05 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 5000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      // 0-100: 100*0.1=$10, 100-5000: 4900*0.05=$245
      expect(result.value).toBe(255);
    });

    it('handles very large unbounded tier usage', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 1000, unitPrice: 0.1 },
        { upToUnits: null, unitPrice: 0.01 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 1000000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      // 0-1000: 1000*0.1=$100, 1000-1000000: 999000*0.01=$9990
      expect(result.value).toBe(10090);
    });
  });

  describe('edge cases', () => {
    it('handles zero usage', () => {
      const plan = createPlan();
      const usage = createUsage({ unitsConsumed: 0 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('handles usage exactly at tier boundary', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 100, unitPrice: 0 },
        { upToUnits: 1000, unitPrice: 0.01 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 100 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('handles usage at second tier boundary', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 100, unitPrice: 0 },
        { upToUnits: 1000, unitPrice: 0.01 },
        { upToUnits: null, unitPrice: 0.005 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 1000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      // 0-100: free, 100-1000: 900*0.01=$9
      expect(result.value).toBe(9);
    });

    it('rounds to 2 decimal places', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 100, unitPrice: 0.033 },
        { upToUnits: null, unitPrice: 0.017 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 200 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      // 100*0.033=$3.3, 100*0.017=$1.7, total=$5
      expect(result.value).toBe(5);
    });
  });

  describe('tier sorting', () => {
    it('sorts tiers in ascending order regardless of input order', () => {
      const tiers: PricingTier[] = [
        { upToUnits: null, unitPrice: 0.005 },
        { upToUnits: 100, unitPrice: 0 },
        { upToUnits: 1000, unitPrice: 0.01 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 500 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      // Should be sorted correctly and produce expected result
      expect(result.value).toBe(4);
    });
  });

  describe('breakdown', () => {
    it('includes tier breakdown in result', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 100, unitPrice: 0 },
        { upToUnits: 1000, unitPrice: 0.01 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 500 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown?.unitsConsumed).toBe(500);
      expect(result.breakdown?.tiers).toBeDefined();
      expect(Array.isArray(result.breakdown?.tiers)).toBe(true);
      expect(result.breakdown?.tiers?.length).toBe(2);
    });

    it('includes detailed tier information in breakdown', () => {
      const tiers: PricingTier[] = [
        { upToUnits: 100, unitPrice: 0 },
        { upToUnits: 1000, unitPrice: 0.01 },
      ];
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 500 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      const tierBreakdown = result.breakdown?.tiers;
      expect(tierBreakdown?.[0].unitsInTier).toBe(100);
      expect(tierBreakdown?.[0].unitPrice).toBe(0);
      expect(tierBreakdown?.[0].amount).toBe(0);
      expect(tierBreakdown?.[1].unitsInTier).toBe(400);
      expect(tierBreakdown?.[1].unitPrice).toBe(0.01);
      expect(tierBreakdown?.[1].amount).toBe(4);
    });
  });

  describe('validation', () => {
    it('throws error if tiers config is missing', () => {
      const plan = createPlan({ config: { tiers: undefined } as any });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('tiers array is required');
    });

    it('throws error if tiers array is empty', () => {
      const plan = createPlan({ config: { tiers: [] } });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('tiers array must not be empty');
    });

    it('throws error if tier unitPrice is negative', () => {
      const tiers: PricingTier[] = [{ upToUnits: 100, unitPrice: -0.01 }];
      const plan = createPlan({ config: { tiers } });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('unitPrice must be a non-negative number');
    });

    it('throws error if tier upToUnits is negative', () => {
      const tiers: PricingTier[] = [{ upToUnits: -100 as any, unitPrice: 0.01 }];
      const plan = createPlan({ config: { tiers } });
      expect(() => {
        strategy.calculate(createUsage(), plan, createSubscriber());
      }).toThrow('upToUnits must be null or a non-negative number');
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
      expect(strategy.getName()).toBe('Tiered Pricing');
    });
  });

  describe('performance', () => {
    it('completes calculation with few tiers in reasonable time', () => {
      const plan = createPlan();
      const usage = createUsage();
      const subscriber = createSubscriber();

      const start = performance.now();
      strategy.calculate(usage, plan, subscriber);
      const duration = performance.now() - start;

      // Should complete well under 5ms
      expect(duration).toBeLessThan(5);
    });

    it('completes calculation with many tiers in reasonable time', () => {
      const tiers: PricingTier[] = [];
      for (let i = 1; i <= 100; i++) {
        tiers.push({
          upToUnits: i * 100,
          unitPrice: 0.01 * i,
        });
      }
      const plan = createPlan({ config: { tiers } });
      const usage = createUsage({ unitsConsumed: 50000 });
      const subscriber = createSubscriber();

      const start = performance.now();
      strategy.calculate(usage, plan, subscriber);
      const duration = performance.now() - start;

      // Should complete well under 5ms even with many tiers
      expect(duration).toBeLessThan(5);
    });
  });
});
