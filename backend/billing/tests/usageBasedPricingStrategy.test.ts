import { UsageBasedPricingStrategy } from '../domain/strategies/UsageBasedPricingStrategy';

describe('UsageBasedPricingStrategy', () => {
  it('multiplies usage units by the usage unit price when provided', () => {
    const strategy = new UsageBasedPricingStrategy();

    const amount = strategy.calculate(
      { units: 250 },
      { typeCode: 'usage_based', price: 0.05, usageUnitPrice: 0.1, currency: 'USD' },
      { id: 'sub-1' }
    );

    expect(amount).toEqual({ value: 25, currency: 'USD' });
  });

  it('uses the plan price as the usage rate when a separate unit price is missing', () => {
    const strategy = new UsageBasedPricingStrategy();

    const amount = strategy.calculate(
      { units: 10 },
      { typeCode: 'usage_based', price: 2.5, currency: 'USD' },
      { id: 'sub-1' }
    );

    expect(amount).toEqual({ value: 25, currency: 'USD' });
  });
});
