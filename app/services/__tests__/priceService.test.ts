import {
  PriceService,
  PriceServiceError,
  PriceFeed,
  Price,
  deviationBps,
  isStale,
} from '../priceService';

/** A controllable in-memory feed for tests. */
class FakeFeed implements PriceFeed {
  constructor(
    public readonly name: string,
    public price: Price | null,
  ) {}
  async getPrice(): Promise<Price | null> {
    return this.price;
  }
}

const quote = (value: number, timestamp: number, source: 'primary' | 'fallback' = 'primary'): Price => ({
  token: 'XLM',
  quote: 'USD',
  value,
  timestamp,
  source,
});

describe('deviation math', () => {
  it('computes basis points relative to previous', () => {
    expect(deviationBps(100, 101)).toBe(100); // +1%
    expect(deviationBps(100, 99)).toBe(100); // -1%
    expect(deviationBps(0, 5)).toBe(0);
  });
});

describe('staleness', () => {
  it('flags observations older than the window', () => {
    expect(isStale(1000, 800, 100)).toBe(true);
    expect(isStale(1000, 950, 100)).toBe(false);
  });
});

describe('PriceService', () => {
  const setup = (now = 1000) => {
    const svc = new PriceService();
    svc.now = () => now;
    return svc;
  };

  it('throws when no feed is registered', async () => {
    const svc = setup();
    await expect(svc.getPrice('XLM', 'USD')).rejects.toMatchObject({ code: 'FEED_NOT_FOUND' });
  });

  it('returns the primary price when fresh', async () => {
    const svc = setup();
    svc.registerFeed('XLM', 'USD', {
      primary: new FakeFeed('p', quote(0.12, 1000)),
      maxStalenessSecs: 300,
      deviationThresholdBps: 1000,
      cacheTtlSecs: 60,
    });
    const price = await svc.getPrice('XLM', 'USD');
    expect(price.value).toBe(0.12);
    expect(price.source).toBe('primary');
  });

  it('falls back when the primary is stale', async () => {
    const svc = setup(2000);
    svc.registerFeed('XLM', 'USD', {
      primary: new FakeFeed('p', quote(0.12, 1000)), // stale
      fallback: new FakeFeed('f', quote(0.13, 1950, 'fallback')), // fresh
      maxStalenessSecs: 300,
      deviationThresholdBps: 100000,
      cacheTtlSecs: 60,
    });
    const price = await svc.getPrice('XLM', 'USD');
    expect(price.source).toBe('fallback');
    expect(price.value).toBe(0.13);
  });

  it('reports STALE_PRICE when every source is stale', async () => {
    const svc = setup(2000);
    svc.registerFeed('XLM', 'USD', {
      primary: new FakeFeed('p', quote(0.12, 1000)),
      maxStalenessSecs: 300,
      deviationThresholdBps: 100000,
      cacheTtlSecs: 60,
    });
    await expect(svc.getPrice('XLM', 'USD')).rejects.toMatchObject({ code: 'STALE_PRICE' });
  });

  it('emits a deviation alert and trips the circuit after repeated faults', async () => {
    const svc = setup();
    const primary = new FakeFeed('p', quote(100, 1000));
    svc.registerFeed('XLM', 'USD', {
      primary,
      maxStalenessSecs: 100000,
      deviationThresholdBps: 100, // 1%
      cacheTtlSecs: 60,
    });
    const alerts: number[] = [];
    svc.onDeviation((info) => alerts.push(info.deviationBps));

    await svc.getPrice('XLM', 'USD'); // baseline, no previous
    primary.price = quote(200, 1000);
    await svc.getPrice('XLM', 'USD'); // +100% deviation -> fault 1
    primary.price = quote(400, 1000);
    await svc.getPrice('XLM', 'USD'); // fault 2
    primary.price = quote(800, 1000);
    await svc.getPrice('XLM', 'USD'); // fault 3 -> trip

    expect(alerts.length).toBe(3);
    expect(svc.getCircuitState('XLM', 'USD')?.tripped).toBe(true);
    await expect(svc.getPrice('XLM', 'USD')).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });

    svc.resetCircuit('XLM', 'USD');
    await expect(svc.getPrice('XLM', 'USD')).resolves.toBeTruthy();
  });

  it('serves cached values within the TTL and refreshes after it', async () => {
    let now = 1000;
    const svc = new PriceService();
    svc.now = () => now;
    const primary = new FakeFeed('p', quote(0.1, 1000));
    svc.registerFeed('XLM', 'USD', {
      primary,
      maxStalenessSecs: 100000,
      deviationThresholdBps: 100000,
      cacheTtlSecs: 300,
    });

    expect((await svc.getPriceWithCache('XLM', 'USD')).value).toBe(0.1);
    now = 1100;
    primary.price = quote(0.2, 1100);
    expect((await svc.getPriceWithCache('XLM', 'USD')).value).toBe(0.1); // cached
    now = 1500;
    expect((await svc.getPriceWithCache('XLM', 'USD')).value).toBe(0.2); // refreshed
  });
});
