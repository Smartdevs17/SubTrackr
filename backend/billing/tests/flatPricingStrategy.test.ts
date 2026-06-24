import { FlatPricingStrategy } from '../domain/strategies/FlatPricingStrategy';

describe('FlatPricingStrategy', () => {
  it('returns the plan price as-is', () => {
    const strategy = new FlatPricingStrategy();

    const amount = strategy.calculate(
      {},
      { typeCode: 'flat', price: 19.99, currency: 'USD' },
      { id: 'sub-1' }
    );

    expect(amount).toEqual({ value: 19.99, currency: 'USD' });
  });
});
