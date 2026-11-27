import { createShopifyBillingAdapter, minorToDecimalString, type ShopifyGraphqlTransport } from '../shopify';

type Reply = { status: number; body: Record<string, unknown> } | Error;

function fake(replies: Reply[]) {
  const calls: Array<{ query: string; variables: Record<string, any> }> = [];
  const transport: ShopifyGraphqlTransport = {
    async query(query, variables) {
      calls.push({ query, variables });
      const next = replies.shift();
      if (!next) throw new Error('unexpected request');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { transport, calls };
}

const retry = { sleep: async () => undefined, baseDelayMs: 0 };
const created = {
  status: 200,
  body: {
    data: {
      appSubscriptionCreate: {
        appSubscription: { id: 'gid://shopify/AppSubscription/1', status: 'PENDING' },
        confirmationUrl: 'https://shop.example/confirm',
        userErrors: [],
      },
    },
  },
};
const request = {
  idempotencyKey: 'k1',
  name: 'Pro',
  returnUrl: 'https://app.example/return',
  price: { amountMinor: 1999, currency: 'USD' },
};

describe('minorToDecimalString', () => {
  it.each([
    [1999, '19.99'],
    [5, '0.05'],
    [100, '1.00'],
    [123456, '1234.56'],
  ])('%i -> %s', (minor, text) => expect(minorToDecimalString(minor)).toBe(text));
});

describe('createShopifyBillingAdapter', () => {
  it('creates a subscription and returns the confirmation url', async () => {
    const { transport, calls } = fake([created]);
    const adapter = createShopifyBillingAdapter({ transport, retry });
    const result = await adapter.createSubscription({ ...request, trialDays: 7, test: true });
    expect(result).toEqual({
      subscriptionId: 'gid://shopify/AppSubscription/1',
      status: 'PENDING',
      confirmationUrl: 'https://shop.example/confirm',
    });
    expect(calls[0].variables).toMatchObject({ name: 'Pro', trialDays: 7, test: true });
    expect(calls[0].variables.lineItems[0].plan.appRecurringPricingDetails).toEqual({
      interval: 'EVERY_30_DAYS',
      price: { amount: '19.99', currencyCode: 'USD' },
    });
  });

  it('is idempotent: same key sends one request, concurrently and afterwards', async () => {
    const { transport, calls } = fake([created, created]);
    const adapter = createShopifyBillingAdapter({ transport, retry });
    const [a, b] = await Promise.all([adapter.createSubscription(request), adapter.createSubscription(request)]);
    const c = await adapter.createSubscription(request);
    expect(a).toEqual(b);
    expect(c).toEqual(a);
    expect(calls).toHaveLength(1);
    await adapter.createSubscription({ ...request, idempotencyKey: 'k2' });
    expect(calls).toHaveLength(2);
  });

  it('retries throttling and 5xx with one logical create, then succeeds', async () => {
    const { transport, calls } = fake([
      { status: 200, body: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] } },
      { status: 502, body: {} },
      created,
    ]);
    const retries: number[] = [];
    const adapter = createShopifyBillingAdapter({
      transport,
      retry: { ...retry, maxAttempts: 3, onRetry: (i) => retries.push(i.attempt) },
    });
    await expect(adapter.createSubscription(request)).resolves.toMatchObject({ status: 'PENDING' });
    expect(calls).toHaveLength(3);
    expect(retries).toEqual([1, 2]);
  });

  it('does not cache failures: the same key can be retried by the caller', async () => {
    const { transport, calls } = fake([{ status: 500, body: {} }, created]);
    const adapter = createShopifyBillingAdapter({ transport, retry: { ...retry, maxAttempts: 1 } });
    await expect(adapter.createSubscription(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', provider: 'shopify' });
    await expect(adapter.createSubscription(request)).resolves.toMatchObject({ status: 'PENDING' });
    expect(calls).toHaveLength(2);
  });

  it('surfaces userErrors as a non-retryable rejection', async () => {
    const { transport, calls } = fake([
      { status: 200, body: { data: { appSubscriptionCreate: { appSubscription: null, userErrors: [{ message: 'Invalid return URL' }] } } } },
    ]);
    const adapter = createShopifyBillingAdapter({ transport, retry });
    await expect(adapter.createSubscription(request)).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED', message: 'Invalid return URL', retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('retries transport errors', async () => {
    const { transport, calls } = fake([new Error('ECONNRESET'), created]);
    const adapter = createShopifyBillingAdapter({ transport, retry });
    await adapter.createSubscription(request);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['missing key', { ...request, idempotencyKey: ' ' }],
    ['missing name', { ...request, name: '' }],
    ['float price', { ...request, price: { amountMinor: 19.99, currency: 'USD' } }],
    ['zero price', { ...request, price: { amountMinor: 0, currency: 'USD' } }],
    ['bad currency', { ...request, price: { amountMinor: 100, currency: 'usd' } }],
  ])('rejects %s without calling Shopify', async (_l, bad) => {
    const { transport, calls } = fake([]);
    const adapter = createShopifyBillingAdapter({ transport, retry });
    await expect(adapter.createSubscription(bad)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(calls).toHaveLength(0);
  });

  it('cancels and fetches subscriptions', async () => {
    const { transport } = fake([
      { status: 200, body: { data: { appSubscriptionCancel: { appSubscription: { id: 'gid://1', status: 'CANCELLED' }, userErrors: [] } } } },
      { status: 200, body: { data: { node: { id: 'gid://1', status: 'ACTIVE' } } } },
      { status: 200, body: { data: { node: null } } },
    ]);
    const adapter = createShopifyBillingAdapter({ transport, retry });
    expect((await adapter.cancelSubscription({ idempotencyKey: 'c', subscriptionId: 'gid://1' })).status).toBe('CANCELLED');
    expect((await adapter.fetchSubscription('gid://1')).status).toBe('ACTIVE');
    await expect(adapter.fetchSubscription('gid://missing')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('emits telemetry for success and failure', async () => {
    const events: any[] = [];
    const { transport } = fake([created, { status: 400, body: { errors: [{ message: 'bad' }] } }]);
    const adapter = createShopifyBillingAdapter({ transport, retry, telemetry: { record: (e) => events.push(e) } });
    await adapter.createSubscription(request);
    await expect(adapter.fetchSubscription('x')).rejects.toThrow();
    expect(events.map((e) => [e.operation, e.provider, e.outcome, e.errorCode])).toEqual([
      ['charge', 'shopify', 'success', undefined],
      ['fetch', 'shopify', 'failure', 'PROVIDER_REJECTED'],
    ]);
  });
});
