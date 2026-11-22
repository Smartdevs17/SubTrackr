import { PerSeatPricingStrategy } from '../domain/strategies/PerSeatPricingStrategy';

describe('PerSeatPricingStrategy', () => {
  it('uses usage seats when present', () => {
    const strategy = new PerSeatPricingStrategy();

    const amount = strategy.calculate(
      { seats: 4 },
      { typeCode: 'per_seat', price: 12, currency: 'USD' },
      { id: 'sub-1', seatCount: 2 }
    );

    expect(amount).toEqual({ value: 48, currency: 'USD' });
  });

  it('falls back to subscriber seats and then one seat', () => {
    const strategy = new PerSeatPricingStrategy();

    const amountFromSubscriber = strategy.calculate(
      {},
      { typeCode: 'per_seat', price: 8, currency: 'USD' },
      { id: 'sub-1', seatCount: 3 }
    );
    const amountDefault = strategy.calculate(
      {},
      { typeCode: 'per_seat', price: 8, currency: 'USD' },
      { id: 'sub-2' }
    );

    expect(amountFromSubscriber).toEqual({ value: 24, currency: 'USD' });
    expect(amountDefault).toEqual({ value: 8, currency: 'USD' });
  });
});
