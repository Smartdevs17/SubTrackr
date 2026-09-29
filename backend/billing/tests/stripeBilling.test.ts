import {
  DEFAULT_STRIPE_API_VERSION,
  StripeApiClient,
  StripeApiError,
  encodeForm,
  isRetryableStatus,
  toIdempotencyKey,
  type StripeFetch,
  type StripeFetchInit,
  type StripeFetchResponse,
} from '../domain/stripe/StripeApiClient';
import { StripeBillingService } from '../domain/stripe/StripeBillingService';

interface RecordedCall {
  readonly url: string;
  readonly init: StripeFetchInit;
  readonly params: URLSearchParams;
}

function json(payload: unknown, status = 200): StripeFetchResponse {
  const text = JSON.stringify(payload);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function stripeError(status: number, code: string, message: string): StripeFetchResponse {
  return json({ error: { type: 'invalid_request_error', code, message, param: 'price' } }, status);
}

function createFetch(responses: readonly StripeFetchResponse[]): {
  fetchImpl: StripeFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl: StripeFetch = async (url, init) => {
    calls.push({ url, init, params: new URLSearchParams(init.body ?? '') });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  };
  return { fetchImpl, calls };
}

function createService(responses: readonly StripeFetchResponse[]): {
  service: StripeBillingService;
  calls: RecordedCall[];
  client: StripeApiClient;
} {
  const { fetchImpl, calls } = createFetch(responses);
  const client = new StripeApiClient({
    secretKey: 'sk_test_key',
    fetchImpl,
    maxAttempts: 1,
    retryBaseDelayMs: 0,
    sleep: async () => undefined,
  });
  return { service: new StripeBillingService({ client, now: () => 1_800_000_000_000 }), calls, client };
}

describe('encodeForm', () => {
  it('flattens nested objects with bracket keys', () => {
    expect(encodeForm({ metadata: { order_id: '7' } })).toEqual({ 'metadata[order_id]': '7' });
  });

  it('indexes arrays of objects positionally', () => {
    expect(encodeForm({ items: [{ price: 'price_1', quantity: 2 }] })).toEqual({
      'items[0][price]': 'price_1',
      'items[0][quantity]': '2',
    });
  });

  it('repeats scalar arrays with an empty bracket', () => {
    expect(encodeForm({ expand: ['a', 'b'] })).toEqual({ 'expand[]': 'a', 'expand[]': 'b' });
  });

  it('drops null and undefined but keeps false and zero', () => {
    expect(
      encodeForm({ a: null, b: undefined, c: false, d: 0, e: '' }),
    ).toEqual({ c: 'false', d: '0', e: '' });
  });

  it('stringifies booleans and numbers', () => {
    expect(encodeForm({ proration_behavior: 'none', quantity: 1, trial: true })).toEqual({
      proration_behavior: 'none',
      quantity: '1',
      trial: 'true',
    });
  });
});

describe('toIdempotencyKey', () => {
  it('returns undefined for a missing or blank key', () => {
    expect(toIdempotencyKey(undefined)).toBeUndefined();
    expect(toIdempotencyKey('   ')).toBeUndefined();
  });

  it('truncates to Stripe’s 255 character limit', () => {
    expect(toIdempotencyKey('a'.repeat(300))).toHaveLength(255);
  });
});

describe('isRetryableStatus', () => {
  it('retries rate limits and server errors', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it('retries a 409 only for an object lock', () => {
    expect(isRetryableStatus(409, 'lock_timeout')).toBe(true);
    expect(isRetryableStatus(409, 'other')).toBe(false);
    expect(isRetryableStatus(409)).toBe(false);
  });

  it('does not retry client errors', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(402)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe('StripeApiClient', () => {
  it('refuses to build without a secret key', () => {
    expect(() => new StripeApiClient({ secretKey: '' })).toThrow('STRIPE_SECRET_KEY');
    expect(() => new StripeApiClient({ secretKey: '  ' })).toThrow('STRIPE_SECRET_KEY');
  });

  it('builds nothing when the environment has no key', () => {
    expect(StripeApiClient.fromEnvironment({})).toBeNull();
    expect(StripeApiClient.fromEnvironment({ STRIPE_SECRET_KEY: '  ' })).toBeNull();
  });

  it('builds from the environment and pins the API version', () => {
    const client = StripeApiClient.fromEnvironment({ STRIPE_SECRET_KEY: 'sk_test_key' });

    expect(client?.getBaseUrl()).toBe('https://api.stripe.com/v1');
    expect(client?.getApiVersion()).toBe(DEFAULT_STRIPE_API_VERSION);
  });

  it('honours a pinned API version', () => {
    const client = StripeApiClient.fromEnvironment({
      STRIPE_SECRET_KEY: 'sk_test_key',
      STRIPE_API_VERSION: '2020-08-27',
    });

    expect(client?.getApiVersion()).toBe('2020-08-27');
  });

  it('sends the bearer token and pinned version', async () => {
    const { fetchImpl, calls } = createFetch([json({ id: 'cus_1' })]);
    const client = new StripeApiClient({ secretKey: 'sk_test_key', fetchImpl });

    await client.get('/customers/cus_1');

    expect(calls[0].init.headers.Authorization).toBe('Bearer sk_test_key');
    expect(calls[0].init.headers['Stripe-Version']).toBe(DEFAULT_STRIPE_API_VERSION);
    expect(calls[0].init.method).toBe('GET');
  });

  it('puts a GET query in the URL and sends no body', async () => {
    const { fetchImpl, calls } = createFetch([json({ data: [] })]);
    const client = new StripeApiClient({ secretKey: 'sk_test_key', fetchImpl });

    await client.get('/subscriptions', { customer: 'cus_1', limit: 5 });

    expect(calls[0].url).toBe('https://api.stripe.com/v1/subscriptions?customer=cus_1&limit=5');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('form-encodes a POST body and sets the content type', async () => {
    const { fetchImpl, calls } = createFetch([json({ id: 'sub_1' })]);
    const client = new StripeApiClient({ secretKey: 'sk_test_key', fetchImpl });

    await client.post('/subscriptions', { customer: 'cus_1', items: [{ price: 'price_1' }] });

    expect(calls[0].init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(calls[0].params.get('customer')).toBe('cus_1');
    expect(calls[0].params.get('items[0][price]')).toBe('price_1');
  });

  it('sends an idempotency key on writes', async () => {
    const { fetchImpl, calls } = createFetch([json({ id: 'cus_1' })]);
    const client = new StripeApiClient({ secretKey: 'sk_test_key', fetchImpl });

    await client.post('/customers', { email: 'a@b.c' }, { idempotencyKey: 'k1' });

    expect(calls[0].init.headers['Idempotency-Key']).toBe('k1');
  });

  it('does not retry a read', async () => {
    const { fetchImpl, calls } = createFetch([stripeError(500, 'api_error', 'boom')]);
    const client = new StripeApiClient({
      secretKey: 'sk_test_key',
      fetchImpl,
      maxAttempts: 3,
      retryBaseDelayMs: 0,
      sleep: async () => undefined,
    });

    await expect(client.get('/customers/cus_1')).rejects.toThrow('boom');
    expect(calls).toHaveLength(1);
  });

  it('retries a throttled write', async () => {
    const { fetchImpl, calls } = createFetch([
      stripeError(429, 'rate_limit', 'slow down'),
      json({ id: 'cus_1' }),
    ]);
    const client = new StripeApiClient({
      secretKey: 'sk_test_key',
      fetchImpl,
      maxAttempts: 3,
      retryBaseDelayMs: 0,
      sleep: async () => undefined,
    });

    const result = await client.post('/customers', { email: 'a@b.c' });

    expect(result).toEqual({ id: 'cus_1' });
    expect(calls).toHaveLength(2);
  });

  it('retries a 409 lock timeout but not another 409', async () => {
    const { fetchImpl, calls } = createFetch([
      stripeError(409, 'lock_timeout', 'locked'),
      json({ id: 'cus_1' }),
    ]);
    const client = new StripeApiClient({
      secretKey: 'sk_test_key',
      fetchImpl,
      maxAttempts: 2,
      retryBaseDelayMs: 0,
      sleep: async () => undefined,
    });

    await client.post('/customers', { email: 'a@b.c' });
    expect(calls).toHaveLength(2);

    const conflict = createFetch([stripeError(409, 'already_exists', 'nope')]);
    const strictClient = new StripeApiClient({
      secretKey: 'sk_test_key',
      fetchImpl: conflict.fetchImpl,
      maxAttempts: 3,
      retryBaseDelayMs: 0,
      sleep: async () => undefined,
    });
    await expect(strictClient.post('/customers', { email: 'a@b.c' })).rejects.toThrow('nope');
    expect(conflict.calls).toHaveLength(1);
  });

  it('raises immediately on a 400', async () => {
    const { fetchImpl, calls } = createFetch([
      stripeError(400, 'resource_missing', 'No such price'),
    ]);
    const client = new StripeApiClient({
      secretKey: 'sk_test_key',
      fetchImpl,
      maxAttempts: 3,
      retryBaseDelayMs: 0,
      sleep: async () => undefined,
    });

    const error = await client.post('/subscriptions', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StripeApiError);
    expect((error as StripeApiError).status).toBe(400);
    expect((error as StripeApiError).code).toBe('resource_missing');
    expect((error as StripeApiError).param).toBe('price');
    expect((error as StripeApiError).retryable).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('retries a transport failure, then reports it', async () => {
    const fetchImpl: StripeFetch = async () => {
      throw new Error('ECONNRESET');
    };
    const client = new StripeApiClient({
      secretKey: 'sk_test_key',
      fetchImpl,
      maxAttempts: 2,
      retryBaseDelayMs: 0,
      sleep: async () => undefined,
    });

    const error = await client.post('/customers', {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StripeApiError);
    expect((error as StripeApiError).code).toBe('stripe_transport_error');
  });

  it('reports a non-JSON success body', async () => {
    const { fetchImpl } = createFetch([
      { ok: true, status: 200, text: async () => '<html>hi</html>' },
    ]);
    const client = new StripeApiClient({ secretKey: 'sk_test_key', fetchImpl });

    await expect(client.get('/customers/cus_1')).rejects.toThrow('not JSON');
  });

  it('returns an empty object for an empty 200 body', async () => {
    const { fetchImpl } = createFetch([{ ok: true, status: 200, text: async () => '' }]);
    const client = new StripeApiClient({ secretKey: 'sk_test_key', fetchImpl });

    await expect(client.delete('/customers/cus_1')).resolves.toEqual({});
  });

  it('falls back to a readable message for a non-JSON error body', async () => {
    const { fetchImpl } = createFetch([
      { ok: false, status: 502, text: async () => '<html>bad gateway</html>' },
    ]);
    const client = new StripeApiClient({
      secretKey: 'sk_test_key',
      fetchImpl,
      maxAttempts: 1,
    });

    const error = await client.get('/customers/cus_1').catch((e: unknown) => e);

    expect((error as StripeApiError).message).toBe('<html>bad gateway</html>');
    expect((error as StripeApiError).retryable).toBe(true);
  });

  it('reports a missing fetch implementation', async () => {
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = undefined;
    try {
      const client = new StripeApiClient({ secretKey: 'sk_test_key' });
      await expect(client.get('/customers/cus_1')).rejects.toThrow('No fetch implementation');
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});

describe('StripeBillingService', () => {
  it('requires a client', () => {
    expect(() => new StripeBillingService({} as never)).toThrow('StripeApiClient');
  });

  describe('customers', () => {
    it('creates a customer keyed on the SubTrackr id', async () => {
      const { service, calls } = createService([json({ id: 'cus_1' })]);

      const customer = await service.createCustomer({
        email: 'ada@example.com',
        name: 'Ada',
        subtrackrCustomerId: 'cust_42',
      });

      expect(customer).toEqual({ id: 'cus_1' });
      expect(calls[0].url).toBe('https://api.stripe.com/v1/customers');
      expect(calls[0].params.get('email')).toBe('ada@example.com');
      expect(calls[0].params.get('metadata[subtrackr_customer_id]')).toBe('cust_42');
      expect(calls[0].init.headers['Idempotency-Key']).toBe('subtrackr:customer:cust_42');
    });

    it('falls back to the email when there is no SubTrackr id', async () => {
      const { service, calls } = createService([json({ id: 'cus_1' })]);

      await service.createCustomer({ email: 'ada@example.com' });

      // `@` is not a legal idempotency-key character, so it is sanitised.
      expect(calls[0].init.headers['Idempotency-Key']).toBe('subtrackr:customer:ada_example.com');
    });

    it('updates and deletes', async () => {
      const { service, calls } = createService([json({ id: 'cus_1' }), json({ deleted: true })]);

      await service.updateCustomer('cus_1', { name: 'Ada L' });
      await service.deleteCustomer('cus_1');

      expect(calls[0].url).toBe('https://api.stripe.com/v1/customers/cus_1');
      expect(calls[1].init.method).toBe('DELETE');
    });
  });

  describe('subscriptions', () => {
    it('creates a subscription with a trial and a payment behaviour', async () => {
      const { service, calls } = createService([json({ id: 'sub_1', status: 'trialing' })]);

      const subscription = await service.createSubscription({
        customerId: 'cus_1',
        items: [{ priceId: 'price_monthly', quantity: 2 }],
        trialPeriodDays: 14,
        skipPayment: true,
        subtrackrSubscriptionId: 'sub_99',
      });

      expect(subscription).toEqual({ id: 'sub_1', status: 'trialing' });
      expect(calls[0].params.get('trial_period_days')).toBe('14');
      expect(calls[0].params.get('items[0][price]')).toBe('price_monthly');
      expect(calls[0].params.get('items[0][quantity]')).toBe('2');
      expect(calls[0].params.get('payment_behavior')).toBe('default_incomplete');
      expect(calls[0].params.get('metadata[subtrackr_subscription_id]')).toBe('sub_99');
      expect(calls[0].init.headers['Idempotency-Key']).toBe('subtrackr:subscription:create:sub_99');
    });

    it('leaves payment behaviour unset when the first invoice is paid', async () => {
      const { service, calls } = createService([json({ id: 'sub_1' })]);

      await service.createSubscription({ customerId: 'cus_1', items: [{ priceId: 'price_1' }] });

      expect(calls[0].params.has('payment_behavior')).toBe(false);
    });

    it('refuses a subscription with no items', async () => {
      const { service, calls } = createService([]);

      await expect(
        service.createSubscription({ customerId: 'cus_1', items: [] }),
      ).rejects.toThrow('at least one item');
      expect(calls).toHaveLength(0);
    });

    it('lists a customer’s subscriptions across all statuses', async () => {
      const { service, calls } = createService([json({ data: [] })]);

      await service.listSubscriptions('cus_1', 25);

      expect(calls[0].url).toContain('status=all');
      expect(calls[0].params.get('limit')).toBe('25');
    });

    it('clamps a nonsensical limit', async () => {
      const { service, calls } = createService([json({ data: [] })]);

      await service.listSubscriptions('cus_1', 5000);
      expect(calls[0].params.get('limit')).toBe('100');

      await service.listSubscriptions('cus_1', 0);
      expect(calls[1].params.get('limit')).toBe('1');
    });

    it('applies proration when the plan changes', async () => {
      const { service, calls } = createService([json({ id: 'sub_1' })]);

      await service.updateSubscription('sub_1', {
        items: [{ priceId: 'price_yearly', quantity: 1 }],
        prorationBehavior: 'create_prorations',
      });

      expect(calls[0].params.get('proration_behavior')).toBe('create_prorations');
      expect(calls[0].params.get('items[0][price]')).toBe('price_yearly');
      expect(calls[0].init.headers['Idempotency-Key']).toBe('subtrackr:subscription:update:sub_1');
    });

    it('ends a trial early with trial_end=now', async () => {
      const { service, calls } = createService([json({ id: 'sub_1' })]);

      await service.updateSubscription('sub_1', { trialEnd: 'now' });

      expect(calls[0].params.get('trial_end')).toBe('now');
    });

    it('converts a trial_end date to unix seconds', async () => {
      const { service, calls } = createService([json({ id: 'sub_1' })]);

      await service.updateSubscription('sub_1', { trialEnd: '2026-10-01T00:00:00.000Z' });

      expect(calls[0].params.get('trial_end')).toBe('1790812800');
    });

    it('rejects an unreadable trial_end', async () => {
      const { service } = createService([]);

      await expect(service.updateSubscription('sub_1', { trialEnd: 'whenever' })).rejects.toThrow(
        'Cannot read trial_end',
      );
    });

    it('schedules cancellation at the period end by default', async () => {
      const { service, calls } = createService([json({ id: 'sub_1', cancel_at_period_end: true })]);

      await service.cancelSubscription('sub_1');

      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].params.get('cancel_at_period_end')).toBe('true');
    });

    it('revokes access immediately when asked', async () => {
      const { service, calls } = createService([json({ id: 'sub_1' })]);

      await service.cancelSubscription('sub_1', false, { prorationBehavior: 'none' });

      expect(calls[0].init.method).toBe('DELETE');
      expect(calls[0].params.get('proration_behavior')).toBe('none');
    });

    it('resumes a scheduled cancellation', async () => {
      const { service, calls } = createService([json({ id: 'sub_1' })]);

      await service.resumeSubscription('sub_1');

      expect(calls[0].params.get('cancel_at_period_end')).toBe('false');
      expect(calls[0].init.headers['Idempotency-Key']).toBe('subtrackr:subscription:resume:sub_1');
    });
  });

  describe('metered usage', () => {
    it('records usage against a subscription item', async () => {
      const { service, calls } = createService([json({ id: 'mbur_1' })]);

      await service.recordUsage({
        subscriptionItemId: 'si_1',
        quantity: 42,
        timestamp: 1_800_000_000,
      });

      expect(calls[0].url).toBe(
        'https://api.stripe.com/v1/subscription_items/si_1/usage_records',
      );
      expect(calls[0].params.get('quantity')).toBe('42');
      expect(calls[0].params.get('action')).toBe('increment');
    });

    it('keys usage on the billing period, so a re-report replays', async () => {
      const { service, calls } = createService([json({ id: 'mbur_1' }), json({ id: 'mbur_1' })]);

      await service.recordUsage({ subscriptionItemId: 'si_1', quantity: 1, timestamp: 1_800_000_000 });
      await service.recordUsage({ subscriptionItemId: 'si_1', quantity: 2, timestamp: 1_800_000_000 });

      expect(calls[0].init.headers['Idempotency-Key']).toBe(
        'subtrackr:usage:si_1:1800000000',
      );
      expect(calls[1].init.headers['Idempotency-Key']).toBe(calls[0].init.headers['Idempotency-Key']);
    });

    it('uses a different key for a different period', async () => {
      const { service, calls } = createService([json({ id: 'mbur_1' }), json({ id: 'mbur_2' })]);

      await service.recordUsage({ subscriptionItemId: 'si_1', quantity: 1, timestamp: 1_800_000_000 });
      await service.recordUsage({ subscriptionItemId: 'si_1', quantity: 1, timestamp: 1_800_086_400 });

      expect(calls[1].init.headers['Idempotency-Key']).not.toBe(
        calls[0].init.headers['Idempotency-Key'],
      );
    });

    it('supports overwriting a period total', async () => {
      const { service, calls } = createService([json({ id: 'mbur_1' })]);

      await service.recordUsage({
        subscriptionItemId: 'si_1',
        quantity: 5,
        timestamp: 1_800_000_000,
        action: 'set',
      });

      expect(calls[0].params.get('action')).toBe('set');
    });

    it('rejects a negative or fractional quantity', async () => {
      const { service, calls } = createService([]);

      await expect(
        service.recordUsage({ subscriptionItemId: 'si_1', quantity: -1, timestamp: 1 }),
      ).rejects.toThrow('non-negative integer');
      await expect(
        service.recordUsage({ subscriptionItemId: 'si_1', quantity: 1.5, timestamp: 1 }),
      ).rejects.toThrow('non-negative integer');
      expect(calls).toHaveLength(0);
    });

    it('rejects a missing timestamp', async () => {
      const { service } = createService([]);

      await expect(
        service.recordUsage({
          subscriptionItemId: 'si_1',
          quantity: 1,
          timestamp: Number.NaN,
        }),
      ).rejects.toThrow('unix timestamp');
    });
  });

  describe('invoices', () => {
    it('previews an upcoming invoice', async () => {
      const { service, calls } = createService([json({ id: 'upcoming' })]);

      await service.getUpcomingInvoice({ customer: 'cus_1' });

      expect(calls[0].url).toContain('/invoices/upcoming');
      expect(calls[0].params.get('customer')).toBe('cus_1');
    });

    it('previews a single subscription', async () => {
      const { service, calls } = createService([json({ id: 'upcoming' })]);

      await service.getUpcomingInvoice({ subscription: 'sub_1' });

      expect(calls[0].params.get('subscription')).toBe('sub_1');
    });

    it('finalizes and pays an invoice', async () => {
      const { service, calls } = createService([json({ id: 'in_1' }), json({ id: 'in_1' })]);

      await service.finalizeInvoice('in_1');
      await service.payInvoice('in_1');

      expect(calls[0].url).toBe('https://api.stripe.com/v1/invoices/in_1/finalize');
      expect(calls[1].url).toBe('https://api.stripe.com/v1/invoices/in_1/pay');
      expect(calls[1].init.headers['Idempotency-Key']).toBe('subtrackr:invoice:pay:in_1');
    });

    it('lists invoices for a customer', async () => {
      const { service, calls } = createService([json({ data: [] })]);

      await service.listInvoices('cus_1', 5);

      expect(calls[0].url).toContain('/invoices?');
      expect(calls[0].params.get('customer')).toBe('cus_1');
    });
  });

  describe('dunning', () => {
    it('sets the payment method and returns the retry cadence', async () => {
      const { service, calls } = createService([json({ id: 'sub_1' })]);

      const result = await service.configureDunning('sub_1', { paymentMethodId: 'pm_1' });

      expect(result.retryDays).toEqual([1, 3, 5, 7]);
      expect(calls[0].params.get('default_payment_method')).toBe('pm_1');
      expect(calls[0].params.get('payment_settings[payment_method_types][]')).toBe('card');
    });

    it('honours a custom retry cadence and 3-D Secure preference', async () => {
      const { service, calls } = createService([json({ id: 'sub_1' })]);

      const result = await service.configureDunning('sub_1', {
        retryDays: [2, 5],
        requestThreeDSecure: true,
      });

      expect(result.retryDays).toEqual([2, 5]);
      expect(
        calls[0].params.get(
          'payment_settings[payment_method_options][card][request_three_d_secure]',
        ),
      ).toBe('automatic');
    });

    it('does not set 3-D Secure when it was not asked for', async () => {
      const { service, calls } = createService([json({ id: 'sub_1' })]);

      await service.configureDunning('sub_1', {});

      expect(
        calls[0].params.has(
          'payment_settings[payment_method_options][card][request_three_d_secure]',
        ),
      ).toBe(false);
    });
  });

  describe('portal, tax ids and payment methods', () => {
    it('creates a portal session with a key that moves with the clock', async () => {
      // A portal session is single-use and short-lived, so the idempotency key
      // must not be replayed from a stale value.
      let clock = 1_800_000_000_000;
      const { fetchImpl, calls } = createFetch([
        json({ url: 'https://billing.stripe.com/p/session' }),
        json({ url: 'https://billing.stripe.com/p/session' }),
      ]);
      const service = new StripeBillingService({
        client: new StripeApiClient({
          secretKey: 'sk_test_key',
          fetchImpl,
          maxAttempts: 1,
          retryBaseDelayMs: 0,
          sleep: async () => undefined,
        }),
        now: () => (clock += 1_000),
      });

      await service.createPortalSession({ customerId: 'cus_1', returnUrl: 'https://app.test' });
      await service.createPortalSession({ customerId: 'cus_1', returnUrl: 'https://app.test' });

      expect(calls[0].params.get('return_url')).toBe('https://app.test');
      expect(calls[1].init.headers['Idempotency-Key']).not.toBe(
        calls[0].init.headers['Idempotency-Key'],
      );
    });

    it('adds, lists and removes a tax id', async () => {
      const { service, calls } = createService([
        json({ id: 'txi_1' }),
        json({ data: [] }),
        json({ deleted: true }),
      ]);

      await service.createTaxId('cus_1', { value: 'DE123456789', type: 'eu_vat' });
      await service.listTaxIds('cus_1');
      await service.deleteTaxId('cus_1', 'txi_1');

      expect(calls[0].url).toBe('https://api.stripe.com/v1/customers/cus_1/tax_ids');
      expect(calls[0].params.get('value')).toBe('DE123456789');
      expect(calls[0].init.headers['Idempotency-Key']).toBe('subtrackr:taxid:cus_1:DE123456789');
      expect(calls[2].url).toBe('https://api.stripe.com/v1/customers/cus_1/tax_ids/txi_1');
      expect(calls[2].init.method).toBe('DELETE');
    });

    it('lists and attaches payment methods', async () => {
      const { service, calls } = createService([json({ data: [] }), json({ id: 'pm_1' })]);

      await service.listPaymentMethods('cus_1');
      await service.attachPaymentMethod('cus_1', 'pm_1');

      expect(calls[0].params.get('customer')).toBe('cus_1');
      expect(calls[0].params.get('type')).toBe('card');
      expect(calls[1].url).toBe('https://api.stripe.com/v1/payment_methods/attach');
      expect(calls[1].params.get('payment_method')).toBe('pm_1');
    });

    it('detaches a payment method', async () => {
      const { service, calls } = createService([json({ id: 'pm_1' })]);

      await service.detachPaymentMethod('pm_1');

      expect(calls[0].url).toBe('https://api.stripe.com/v1/payment_methods/pm_1/detach');
    });
  });
});
