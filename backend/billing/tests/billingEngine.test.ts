import { performance } from 'perf_hooks';
import { BillingEngine } from '../domain/BillingEngine';
import { StrategyRegistry } from '../domain/StrategyRegistry';
import { FlatPricingStrategy } from '../domain/strategies/FlatPricingStrategy';
import { PerSeatPricingStrategy } from '../domain/strategies/PerSeatPricingStrategy';
import { TieredPricingStrategy } from '../domain/strategies/TieredPricingStrategy';
import { UsageBasedPricingStrategy } from '../domain/strategies/UsageBasedPricingStrategy';
import type { BillingPlan } from '../domain/types';

describe('BillingEngine', () => {
  it('delegates to the registered strategy for each plan type', () => {
    const engine = new BillingEngine(
      new StrategyRegistry([
        new FlatPricingStrategy(),
        new PerSeatPricingStrategy(),
        new UsageBasedPricingStrategy(),
        new TieredPricingStrategy(),
      ])
    );

    expect(
      engine.calculate({ units: 2 }, { typeCode: 'flat', price: 5, currency: 'USD' }, { id: 'sub' })
    ).toEqual({ value: 5, currency: 'USD' });
    expect(
      engine.calculate(
        { seats: 3 },
        { typeCode: 'per_seat', price: 5, currency: 'USD' },
        { id: 'sub', seatCount: 1 }
      )
    ).toEqual({ value: 15, currency: 'USD' });
    expect(
      engine.calculate(
        { units: 10 },
        { typeCode: 'usage_based', price: 2, currency: 'USD' },
        { id: 'sub' }
      )
    ).toEqual({ value: 20, currency: 'USD' });
    expect(
      engine.calculate(
        { units: 5 },
        { typeCode: 'tiered', price: 0, currency: 'USD', tiers: [{ upTo: null, unitPrice: 3 }] },
        { id: 'sub' }
      )
    ).toEqual({ value: 15, currency: 'USD' });
  });

  it('uses the fallback strategy for unsupported plan types', () => {
    const engine = new BillingEngine();

    expect(
      engine.calculate({ units: 12 }, { typeCode: 'custom', price: 9.5, currency: 'USD' }, { id: 'sub' })
    ).toEqual({ value: 9.5, currency: 'USD' });
  });

  it('accepts common plan type aliases when resolving a strategy', () => {
    const engine = new BillingEngine();
    const aliasPlan = { planTypeCode: 'usage-based', price: 4, currency: 'USD' } as BillingPlan;

    expect(engine.calculate({ units: 2 }, aliasPlan, { id: 'sub' })).toEqual({ value: 8, currency: 'USD' });
  });

  it('aliases calculateInvoice and calculateInvoiceAmount', () => {
    const engine = new BillingEngine();
    const usage = { units: 4 };
    const plan = { typeCode: 'flat', price: 2, currency: 'USD' };
    const subscriber = { id: 'sub' };

    expect(engine.calculateInvoice(usage, plan, subscriber)).toEqual({ value: 2, currency: 'USD' });
    expect(engine.calculateInvoiceAmount(usage, plan, subscriber)).toEqual({ value: 2, currency: 'USD' });
  });

  it('calculates invoices quickly enough for repeated lookups', () => {
    const engine = new BillingEngine();
    const plan = { typeCode: 'tiered', price: 0, currency: 'USD', tiers: [{ upTo: null, unitPrice: 1 }] };
    const subscriber = { id: 'sub' };

    const start = performance.now();
    let total = 0;

    for (let i = 0; i < 10000; i += 1) {
      total += engine.calculate({ units: i % 10 }, plan, subscriber).value;
    }

    const elapsed = performance.now() - start;

    expect(total).toBeGreaterThan(0);
    expect(elapsed / 10000).toBeLessThan(5);
  });
});
