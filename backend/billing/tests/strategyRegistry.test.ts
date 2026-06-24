import { StrategyRegistry } from '../domain/StrategyRegistry';
import type { PricingStrategy } from '../domain/PricingStrategy';

describe('StrategyRegistry', () => {
  const makeStrategy = (code: string, value: number): PricingStrategy => ({
    code,
    calculate: () => ({ value, currency: 'USD' }),
  });

  it('resolves registered strategies by plan type code', () => {
    const registry = new StrategyRegistry([makeStrategy('flat', 10), makeStrategy('tiered', 20)]);

    expect(registry.has('flat')).toBe(true);
    expect(registry.resolve('tiered').calculate({}, { typeCode: 'tiered', price: 0, currency: 'USD' }, { id: 'sub' })).toEqual({
      value: 20,
      currency: 'USD',
    });
  });

  it('falls back for unknown strategies', () => {
    const registry = new StrategyRegistry([makeStrategy('flat', 10)]);
    const strategy = registry.resolve('missing');

    expect(strategy.code).toBe('fallback');
    expect(strategy.calculate({}, { typeCode: 'missing', price: 11, currency: 'USD' }, { id: 'sub' })).toEqual({
      value: 11,
      currency: 'USD',
    });
  });

  it('allows registering new strategies dynamically', () => {
    const registry = new StrategyRegistry();

    registry.register(makeStrategy('custom', 42));

    expect(registry.has('custom')).toBe(true);
    expect(registry.resolve('custom').calculate({}, { typeCode: 'custom', price: 0, currency: 'USD' }, { id: 'sub' })).toEqual({
      value: 42,
      currency: 'USD',
    });
  });
});
