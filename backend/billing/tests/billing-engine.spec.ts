/**
 * BillingEngine Tests
 *
 * Validates the BillingEngine's ability to delegate to strategies
 * and produce correct billing calculations.
 */

import { BillingEngine } from '../domain/billing-engine';
import { resetStrategyRegistry, getStrategyRegistry } from '../domain/strategy-registry';
import { FlatPricingStrategy } from '../domain/strategies/flat-pricing.strategy';
import type { Plan, Subscriber, Usage, PricingStrategy } from '../domain/strategies/pricing-strategy.interface';

describe('BillingEngine', () => {
  let engine: BillingEngine;

  const createPlan = (overrides?: Partial<Plan>): Plan => ({
    id: 'plan_1',
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
    resetStrategyRegistry();
    engine = new BillingEngine();
  });

  describe('initialization', () => {
    it('initializes successfully', () => {
      expect(engine).toBeDefined();
      expect(typeof engine.calculate).toBe('function');
    });

    it('has access to strategy registry', () => {
      const models = engine.getAvailablePricingModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('calculation delegation', () => {
    it('delegates to flat pricing strategy', () => {
      const plan = createPlan({ typeCode: 'flat', basePrice: 50 });
      const result = engine.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(50);
      expect(result.currency).toBe('USD');
    });

    it('delegates to per-seat pricing strategy', () => {
      const plan = createPlan({
        typeCode: 'per-seat',
        basePrice: 10,
      });
      const usage = createUsage({ seatCount: 5 });
      const result = engine.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(50);
    });

    it('delegates to usage-based pricing strategy', () => {
      const plan = createPlan({
        typeCode: 'usage-based',
        basePrice: 0,
        config: { unitPrice: 0.05, includedUnits: 0 },
      });
      const usage = createUsage({ unitsConsumed: 1000 });
      const result = engine.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(50);
    });

    it('delegates to tiered pricing strategy', () => {
      const plan = createPlan({
        typeCode: 'tiered',
        config: {
          tiers: [
            { upToUnits: 100, unitPrice: 0 },
            { upToUnits: 1000, unitPrice: 0.01 },
            { upToUnits: null, unitPrice: 0.005 },
          ],
        },
      });
      const usage = createUsage({ unitsConsumed: 500 });
      const result = engine.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(4);
    });
  });

  describe('fallback for unknown types', () => {
    it('uses fallback strategy for unknown plan type', () => {
      const plan = createPlan({
        typeCode: 'completely-unknown-pricing',
        basePrice: 75,
      });
      const result = engine.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(75);
      expect(result.breakdown?.strategy).toBe('fallback');
    });

    it('does not throw for unknown plan types', () => {
      const plan = createPlan({
        typeCode: 'future-pricing-model-v2',
        basePrice: 100,
      });

      expect(() => {
        engine.calculate(createUsage(), plan, createSubscriber());
      }).not.toThrow();
    });
  });

  describe('custom strategy support', () => {
    it('allows using custom registered strategies', () => {
      const mockStrategy: PricingStrategy = {
        getName: () => 'Custom Strategy',
        calculate: (usage, plan, subscriber) => ({
          value: 999,
          currency: 'USD',
          breakdown: { customized: true },
        }),
      };

      const registry = getStrategyRegistry();
      registry.register('custom', mockStrategy);

      const plan = createPlan({ typeCode: 'custom' });
      const result = engine.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBe(999);
      expect(result.breakdown?.customized).toBe(true);
    });
  });

  describe('validation', () => {
    it('throws error if plan is null', () => {
      expect(() => {
        engine.calculate(createUsage(), null as any, createSubscriber());
      }).toThrow('Plan is required');
    });

    it('throws error if plan is undefined', () => {
      expect(() => {
        engine.calculate(createUsage(), undefined as any, createSubscriber());
      }).toThrow('Plan is required');
    });

    it('throws if strategy throws (propagates errors)', () => {
      const plan = createPlan({
        typeCode: 'flat',
        basePrice: -100,
      });

      expect(() => {
        engine.calculate(createUsage(), plan, createSubscriber());
      }).toThrow();
    });
  });

  describe('available pricing models', () => {
    it('lists flat pricing as available', () => {
      const models = engine.getAvailablePricingModels();
      expect(models).toContain('flat');
    });

    it('lists per-seat pricing as available', () => {
      const models = engine.getAvailablePricingModels();
      expect(models).toContain('per-seat');
    });

    it('lists usage-based pricing as available', () => {
      const models = engine.getAvailablePricingModels();
      expect(models).toContain('usage-based');
    });

    it('lists tiered pricing as available', () => {
      const models = engine.getAvailablePricingModels();
      expect(models).toContain('tiered');
    });

    it('includes custom strategies after registration', () => {
      const registry = getStrategyRegistry();
      registry.register('enterprise-plus', new FlatPricingStrategy());

      const models = engine.getAvailablePricingModels();
      expect(models).toContain('enterprise-plus');
    });

    it('returns non-empty list', () => {
      const models = engine.getAvailablePricingModels();
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('result structure', () => {
    it('returns Amount with value and currency', () => {
      const plan = createPlan();
      const result = engine.calculate(createUsage(), plan, createSubscriber());

      expect(result.value).toBeDefined();
      expect(typeof result.value).toBe('number');
      expect(result.currency).toBeDefined();
      expect(typeof result.currency).toBe('string');
    });

    it('includes breakdown in result', () => {
      const plan = createPlan();
      const result = engine.calculate(createUsage(), plan, createSubscriber());

      expect(result.breakdown).toBeDefined();
    });

    it('breakdown contains strategy details', () => {
      const plan = createPlan({
        typeCode: 'per-seat',
        basePrice: 20,
      });
      const usage = createUsage({ seatCount: 5 });
      const result = engine.calculate(usage, plan, createSubscriber());

      expect(result.breakdown?.pricePerSeat).toBe(20);
      expect(result.breakdown?.seatCount).toBe(5);
    });
  });

  describe('performance', () => {
    it('completes calculation in reasonable time', () => {
      const plan = createPlan();
      const usage = createUsage();
      const subscriber = createSubscriber();

      const start = performance.now();
      engine.calculate(usage, plan, subscriber);
      const duration = performance.now() - start;

      // Should complete well under 5ms
      expect(duration).toBeLessThan(5);
    });

    it('completes batch calculations efficiently', () => {
      const plans = [
        createPlan({ typeCode: 'flat' }),
        createPlan({ typeCode: 'per-seat' }),
        createPlan({ typeCode: 'usage-based', config: { unitPrice: 0.1, includedUnits: 0 } }),
        createPlan({ typeCode: 'tiered', config: { tiers: [{ upToUnits: null, unitPrice: 0.01 }] } }),
      ];

      const start = performance.now();
      for (const plan of plans) {
        engine.calculate(createUsage(), plan, createSubscriber());
      }
      const duration = performance.now() - start;

      // All 4 calculations should complete well under 5ms
      expect(duration).toBeLessThan(5);
    });
  });

  describe('pricing model diversity', () => {
    it('handles all built-in pricing models in single session', () => {
      const results = [
        engine.calculate(
          createUsage(),
          createPlan({ typeCode: 'flat', basePrice: 50 }),
          createSubscriber()
        ),
        engine.calculate(
          createUsage({ seatCount: 10 }),
          createPlan({ typeCode: 'per-seat', basePrice: 5 }),
          createSubscriber()
        ),
        engine.calculate(
          createUsage({ unitsConsumed: 1000 }),
          createPlan({
            typeCode: 'usage-based',
            config: { unitPrice: 0.1, includedUnits: 0 },
          }),
          createSubscriber()
        ),
        engine.calculate(
          createUsage({ unitsConsumed: 500 }),
          createPlan({
            typeCode: 'tiered',
            config: {
              tiers: [
                { upToUnits: 100, unitPrice: 0 },
                { upToUnits: null, unitPrice: 0.01 },
              ],
            },
          }),
          createSubscriber()
        ),
      ];

      expect(results.length).toBe(4);
      expect(results.every((r) => typeof r.value === 'number')).toBe(true);
      expect(results.every((r) => r.currency === 'USD')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles plan with empty typeCode', () => {
      const plan = createPlan({ typeCode: '' });
      const result = engine.calculate(createUsage(), plan, createSubscriber());

      // Should fall back to fallback strategy
      expect(result.breakdown?.strategy).toBe('fallback');
    });

    it('handles plan with whitespace typeCode', () => {
      const plan = createPlan({ typeCode: '   ' });
      const result = engine.calculate(createUsage(), plan, createSubscriber());

      // Should fall back to fallback strategy
      expect(result.breakdown?.strategy).toBe('fallback');
    });

    it('handles case-insensitive typeCode matching', () => {
      const plan1 = createPlan({ typeCode: 'FLAT' });
      const plan2 = createPlan({ typeCode: 'flat' });
      const plan3 = createPlan({ typeCode: 'Flat' });

      const result1 = engine.calculate(createUsage(), plan1, createSubscriber());
      const result2 = engine.calculate(createUsage(), plan2, createSubscriber());
      const result3 = engine.calculate(createUsage(), plan3, createSubscriber());

      expect(result1.value).toBe(result2.value);
      expect(result2.value).toBe(result3.value);
    });
  });

  describe('integration scenarios', () => {
    it('handles real-world scenario: customer upgrade from flat to per-seat', () => {
      // Original plan: $99/month
      const flatPlan = createPlan({ typeCode: 'flat', basePrice: 99 });
      const flatResult = engine.calculate(createUsage(), flatPlan, createSubscriber());

      // Upgraded plan: $25 per seat, 5 seats
      const perSeatPlan = createPlan({
        typeCode: 'per-seat',
        basePrice: 25,
      });
      const usage = createUsage({ seatCount: 5 });
      const perSeatResult = engine.calculate(usage, perSeatPlan, createSubscriber());

      expect(flatResult.value).toBe(99);
      expect(perSeatResult.value).toBe(125);
      expect(perSeatResult.value).toBeGreaterThan(flatResult.value);
    });

    it('handles real-world scenario: usage-based overages', () => {
      const plan = createPlan({
        typeCode: 'usage-based',
        config: {
          unitPrice: 0.05,
          includedUnits: 10000,
        },
      });

      // Within included units
      const lightUsage = createUsage({ unitsConsumed: 5000 });
      const lightResult = engine.calculate(lightUsage, plan, createSubscriber());
      expect(lightResult.value).toBe(0);

      // With overage
      const heavyUsage = createUsage({ unitsConsumed: 15000 });
      const heavyResult = engine.calculate(heavyUsage, plan, createSubscriber());
      expect(heavyResult.value).toBe(250);
    });
  });
});
