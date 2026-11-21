import {
  PriceAlertError,
  changePercent,
  createHttpPriceProvider,
  createPriceAlerter,
  createScrapePriceProvider,
  normaliseQuote,
  parsePriceFromText,
  shouldAlert,
} from '../priceAlerts';
import type { AlertRule, PriceProvider, PriceQuote, PriceScraper } from '../priceAlerts';

function quote(price: number, observedAt = 1000, source: PriceQuote['source'] = 'api'): PriceQuote {
  return { symbol: 'BTC', price, currency: 'USD', source, observedAt };
}

function provider(
  source: PriceProvider['source'],
  implementation: (symbol: string) => Promise<PriceQuote>
): PriceProvider {
  return { source, fetchPrice: jest.fn(implementation) };
}

function makeAlerter(overrides: Record<string, unknown> = {}) {
  let current = 1000;
  const primary = provider('api', async () => quote(100, current));
  const sink = { send: jest.fn(async () => undefined) };
  const metrics = { increment: jest.fn(), gauge: jest.fn(), timing: jest.fn() };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const alerter = createPriceAlerter({
    primary,
    sink,
    rules: [],
    metrics,
    logger,
    now: () => current,
    idFactory: () => 'alert-1',
    ...overrides,
  });
  return { alerter, primary, sink, metrics, logger, setNow: (value: number) => (current = value) };
}

describe('pure helpers', () => {
  it('normalises and validates quotes', () => {
    expect(
      normaliseQuote({ symbol: ' btc ', price: '12.5', currency: 'USD', observedAt: 1 }, 'api')
    ).toEqual({
      symbol: 'BTC',
      price: 12.5,
      currency: 'USD',
      source: 'api',
      observedAt: 1,
    });
    expect(() => normaliseQuote({ symbol: '', price: 1, currency: 'USD' }, 'api')).toThrow(
      /needs a symbol/
    );
    expect(() => normaliseQuote({ symbol: 'BTC', price: -1, currency: 'USD' }, 'api')).toThrow(
      /positive numeric price/
    );
    expect(() => normaliseQuote({ symbol: 'BTC', price: 1, currency: 'usd' }, 'api')).toThrow(
      /upper-case ISO/
    );
  });

  it('parses scraped prices with separators and currency symbols', () => {
    expect(parsePriceFromText('Last: $1,234.56 USD', /Last:\s*\$([\d,.]+)/)).toBe(1234.56);
    expect(parsePriceFromText('price 42', /price\s+(\d+)/)).toBe(42);
    expect(() => parsePriceFromText('nothing here', /price\s+(\d+)/)).toThrow(/did not contain/);
    expect(() => parsePriceFromText('price abc', /price\s+([a-z]+)/)).toThrow(/not a positive/);
  });

  it('computes directional alerts', () => {
    expect(changePercent(100, 105)).toBeCloseTo(5);
    const rule: AlertRule = { id: 'r1', symbol: 'BTC', changePercent: 2 };
    expect(shouldAlert(quote(100), quote(105), rule)).toBe('up');
    expect(shouldAlert(quote(100), quote(98), rule)).toBe('down');
    expect(shouldAlert(quote(100), quote(101), rule)).toBeNull();
    expect(shouldAlert(quote(100), quote(105), { ...rule, direction: 'down' })).toBeNull();
    expect(shouldAlert(quote(100), quote(105), { ...rule, direction: 'both' })).toBe('up');
  });

  it('validates alert rules', () => {
    expect(() =>
      createPriceAlerter({
        primary: provider('api', async () => quote(100)),
        sink: { send: async () => undefined },
        rules: [{ id: 'r1', symbol: 'BTC', changePercent: -1 }],
      })
    ).toThrow(/positive threshold/);
  });
});

describe('providers', () => {
  it('reads a JSON price API response', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return { price: '42.5', currency: 'USD', timestamp: '2026-01-01T00:00:00.000Z' };
      },
    }));
    const alerterProvider = createHttpPriceProvider({
      url: (symbol) => `https://prices.example.com/${symbol}`,
      fetchImpl,
      apiKey: 'unit-test-key',
    });

    const result = await alerterProvider.fetchPrice('btc');

    expect(result).toMatchObject({ symbol: 'BTC', price: 42.5, currency: 'USD', source: 'api' });
    expect(fetchImpl).toHaveBeenCalledWith('https://prices.example.com/btc', {
      headers: { 'x-api-key': 'unit-test-key' },
    });
  });

  it('reports HTTP failures as typed fetch errors', async () => {
    const alerterProvider = createHttpPriceProvider({
      url: 'https://prices.example.com',
      fetchImpl: jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    });
    await expect(alerterProvider.fetchPrice('BTC')).rejects.toMatchObject({
      code: 'FETCH_FAILED',
    });
  });

  it('builds a scraper-backed fallback provider', async () => {
    const scraper: PriceScraper = { scrape: jest.fn(async () => 'Spot: $1,234.56') };
    const fallback = createScrapePriceProvider({
      scraper,
      rules: [{ symbol: 'BTC', pattern: /Spot:\s*\$([\d,.]+)/ }],
      now: () => 1234,
    });

    await expect(fallback.fetchPrice('BTC')).resolves.toEqual({
      symbol: 'BTC',
      price: 1234.56,
      currency: 'USD',
      source: 'scrape',
      observedAt: 1234,
    });
    await expect(fallback.fetchPrice('ETH')).rejects.toMatchObject({ code: 'NO_DATA' });
  });
});

describe('createPriceAlerter.getQuote', () => {
  it('serves a fresh cached quote without calling the provider again', async () => {
    const { alerter, primary } = makeAlerter();
    await alerter.getQuote('BTC');
    const second = await alerter.getQuote('BTC');

    expect(primary.fetchPrice).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ cacheHit: true, stale: false });
  });

  it('falls back to the secondary provider when the primary fails', async () => {
    const primary = provider('api', async () => {
      throw new Error('API down');
    });
    const fallback = provider('scrape', async () => quote(120, 1000, 'scrape'));
    const scraper: PriceScraper = { scrape: jest.fn(async () => 'Spot: $125.00') };
    const { alerter, metrics } = makeAlerter({
      primary,
      fallback,
      scrape: { scraper, rules: [{ symbol: 'BTC', pattern: /Spot:\s*\$([\d,.]+)/ }] },
    });

    const resolved = await alerter.getQuote('BTC');

    expect(resolved.quote.source).toBe('scrape');
    expect(resolved.quote.price).toBe(120);
    expect(metrics.increment).toHaveBeenCalledWith('subtrackr.priceAlerts.fetch_failed', 1, {
      symbol: 'BTC',
      source: 'api',
      code: 'FETCH_FAILED',
    });
  });

  it('uses the scraper when both API providers fail', async () => {
    const primary = provider('api', async () => {
      throw new Error('API down');
    });
    const fallback = provider('scrape', async () => {
      throw new PriceAlertError('FETCH_FAILED', 'Fallback down');
    });
    const scraper: PriceScraper = { scrape: jest.fn(async () => 'Spot: $125.00') };
    const { alerter } = makeAlerter({
      primary,
      fallback,
      scrape: { scraper, rules: [{ symbol: 'BTC', pattern: /Spot:\s*\$([\d,.]+)/ }] },
    });

    const resolved = await alerter.getQuote('BTC');

    expect(resolved.quote.price).toBe(125);
    expect(resolved.quote.source).toBe('scrape');
  });

  it('serves a stale cached quote inside the grace window and fails after it', async () => {
    let calls = 0;
    const primary = provider('api', async () => {
      calls += 1;
      if (calls === 1) return quote(100, 1000);
      throw new Error('API down');
    });
    const { alerter, setNow } = makeAlerter({
      primary,
      cacheTtlMs: 100,
      maxStalenessMs: 60_000,
    });

    await alerter.getQuote('BTC');
    setNow(2000);
    await expect(alerter.getQuote('BTC')).resolves.toMatchObject({ stale: true, cacheHit: false });

    setNow(61_500);
    await expect(alerter.getQuote('BTC')).rejects.toMatchObject({ code: 'NO_DATA' });
  });

  it('throws NO_DATA when nothing can produce a quote', async () => {
    const primary = provider('api', async () => {
      throw new PriceAlertError('NO_DATA', 'No market data', true);
    });
    const { alerter } = makeAlerter({ primary });
    await expect(alerter.getQuote('BTC')).rejects.toMatchObject({
      code: 'NO_DATA',
      retryable: true,
    });
  });
});

describe('createPriceAlerter.evaluate', () => {
  const rules: AlertRule[] = [
    { id: 'up-2', symbol: 'BTC', changePercent: 2, direction: 'up' },
    { id: 'down-2', symbol: 'BTC', changePercent: 2, direction: 'down' },
  ];

  it('does not alert without a baseline', async () => {
    const { alerter } = makeAlerter({ rules });
    expect(await alerter.evaluate(quote(105))).toEqual([]);
    expect(alerter.getBaseline('BTC')?.price).toBe(105);
  });

  it('sends an alert and suppresses the same rule during its cooldown', async () => {
    const { alerter, sink, metrics, setNow } = makeAlerter({ rules });
    alerter.setBaseline(quote(100));

    const first = await alerter.evaluate(quote(104, 1100, 'scrape'));

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      ruleId: 'up-2',
      direction: 'up',
      previousPrice: 100,
      currentPrice: 104,
      source: 'scrape',
    });
    expect(sink.send).toHaveBeenCalledTimes(1);
    expect(metrics.increment).toHaveBeenCalledWith('subtrackr.priceAlerts.alert_sent', 1, {
      ruleId: 'up-2',
      symbol: 'BTC',
      direction: 'up',
    });

    setNow(2000);
    expect(await alerter.evaluate(quote(108, 2000))).toEqual([]);
    setNow(1_000_000);
    expect(await alerter.evaluate(quote(112, 1_000_000))).toHaveLength(1);
  });

  it('keeps delivering other alerts when one sink fails', async () => {
    const sink = {
      send: jest.fn(async (alert: { ruleId: string }) => {
        if (alert.ruleId === 'up-fail') throw new Error('mailbox full');
      }),
    };
    const { alerter, logger } = makeAlerter({
      rules: [
        { id: 'up-fail', symbol: 'BTC', changePercent: 1, direction: 'up' },
        { id: 'up-ok', symbol: 'BTC', changePercent: 1, direction: 'up' },
      ],
      sink,
    });
    alerter.setBaseline(quote(100));

    const alerts = await alerter.evaluate(quote(101));

    expect(alerts.map((alert) => alert.ruleId)).toEqual(['up-ok']);
    expect(logger.error).toHaveBeenCalled();
  });

  it('combines quote resolution and evaluation in check()', async () => {
    const { alerter } = makeAlerter({ rules });
    alerter.setBaseline(quote(100));

    const result = await alerter.check('BTC');

    expect(result.quote.price).toBe(100);
    expect(result.alerts).toEqual([]);
  });
});
