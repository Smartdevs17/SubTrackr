/**
 * PerSeatPricingStrategy Tests
 *
 * Validates that per-seat pricing correctly multiplies seat count
 * by the price per seat.
 */

import { PerSeatPricingStrategy } from '../domain/strategies/per-seat-pricing.strategy';
import type { Plan, Subscriber, Usage } from '../domain/strategies/pricing-strategy.interface';

describe('PerSeatPricingStrategy', () => {
  let strategy: PerSeatPricingStrategy;

  const createPlan = (overrides?: Partial<Plan>): Plan => ({
    id: 'plan_seat_1',
    typeCode: 'per-seat',
    basePrice: 10,
    currency: 'USD',
    ...overrides,
  });

  const createUsage = (overrides?: Partial<Usage>): Usage => ({
    id: 'usage_1',
    unitsConsumed: 0,
    seatCount: 5,
    ...overrides,
  });

  const createSubscriber = (overrides?: Partial<Subscriber>): Subscriber => ({
    id: 'sub_1',
    subscriptionId: 'sub_1',
    ...overrides,
  });

  beforeEach(() => {
    strategy = new PerSeatPricingStrategy();
  });

  describe('basic pricing', () => {
    it('multiplies price per seat by seat count', () => {
      const plan = createPlan({ basePrice: 10 });
      const usage = createUsage({ seatCount: 5 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(50);
      expect(result.currency).toBe('USD');
    });

    it('handles single seat', () => {
      const plan = createPlan({ basePrice: 25 });
      const usage = createUsage({ seatCount: 1 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(25);
    });

    it('handles large seat counts', () => {
      const plan = createPlan({ basePrice: 5.5 });
      const usage = createUsage({ seatCount: 1000 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(5500);
    });
  });

  describe('edge cases', () => {
    it('handles zero seats', () => {
      const plan = createPlan({ basePrice: 20 });
      const usage = createUsage({ seatCount: 0 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('handles zero price per seat', () => {
      const plan = createPlan({ basePrice: 0 });
      const usage = createUsage({ seatCount: 100 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(0);
    });

    it('floors fractional seats', () => {
      const plan = createPlan({ basePrice: 10 });
      const usage = createUsage({ seatCount: 5.9 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(50);
    });

    it('rounds to 2 decimal places', () => {
      const plan = createPlan({ basePrice: 10.333 });
      const usage = createUsage({ seatCount: 3 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.value).toBe(31);
    });
  });

  describe('breakdown', () => {
    it('includes pricePerSeat, seatCount, and total in breakdown', () => {
      const plan = createPlan({ basePrice: 20 });
      const usage = createUsage({ seatCount: 5 });
      const result = strategy.calculate(usage, plan, createSubscriber());

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown?.pricePerSeat).toBe(20);
      expect(result.breakdown?.seatCount).toBe(5);
      expect(result.breakdown?.total).toBe(100);
    });
  });

  describe('validation', () => {
    it('throws error if plan is null', () => {
      expect(() => {
        strategy.calculate(createUsage(), null as any, createSubscriber());
      }).toThrow('Invalid plan');
    });

    it('throws error if basePrice is negative', () => {
      const plan = createPlan({ basePrice: -5 });
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

    it('throws error if usage is null', () => {
      const plan = createPlan();
      expect(() => {
        strategy.calculate(null as any, plan, createSubscriber());
      }).toThrow('Invalid usage');
    });

    it('throws error if seatCount is negative', () => {
      const plan = createPlan();
      const usage = createUsage({ seatCount: -1 });
      expect(() => {
        strategy.calculate(usage, plan, createSubscriber());
      }).toThrow('seatCount must be a non-negative number');
    });

    it('throws error if seatCount is not a number', () => {
      const plan = createPlan();
      const usage = createUsage({ seatCount: 'invalid' as any });
      expect(() => {
        strategy.calculate(usage, plan, createSubscriber());
      }).toThrow('seatCount must be a non-negative number');
    });
  });

  describe('strategy name', () => {
    it('returns human-readable name', () => {
      expect(strategy.getName()).toBe('Per-Seat Pricing');
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
