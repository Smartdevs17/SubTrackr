import { TieredPricingStrategy } from '../domain/strategies/TieredPricingStrategy';

describe('TieredPricingStrategy', () => {
  it('applies cumulative tier rates across the usage range', () => {
    const strategy = new TieredPricingStrategy();

    const amount = strategy.calculate(
      { units: 250 },
      {
        typeCode: 'tiered',
        price: 0,
        currency: 'USD',
        tiers: [
          { upTo: 100, unitPrice: 1 },
          { upTo: 200, unitPrice: 0.8 },
          { upTo: null, unitPrice: 0.5 },
        ],
      },
      { id: 'sub-1' }
    );

    expect(amount).toEqual({ value: 205, currency: 'USD' });
  });

  it('falls back to the plan price when no tiers are defined', () => {
    const strategy = new TieredPricingStrategy();

    const amount = strategy.calculate(
      { units: 3 },
      { typeCode: 'tiered', price: 7.5, currency: 'USD' },
      { id: 'sub-1' }
    );

    expect(amount).toEqual({ value: 22.5, currency: 'USD' });
  });
});
