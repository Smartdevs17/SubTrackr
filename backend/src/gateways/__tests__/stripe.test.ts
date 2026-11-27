import { BillingAdapterError, withIdempotentRetry, type BillingTransport } from '../billingAdapter';
import { calculateProration, createStripeSubscriptionAdapter } from '../stripe';

const PERIOD_START = 1_700_000_000;
const PERIOD_END = PERIOD_START + 30 * 86400;
const MID = PERIOD_START + 15 * 86400;

function subscription(priceId: string, unit: number, extra: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    current_period_start: PERIOD_START,
    current_period_end: PERIOD_END,
    cancel_at_period_end: false,
    items: { data: [{ id: 'si_1', quantity: 1, price: { id: priceId, unit_amount: unit } }] },
    ...extra,
  };
}

type Reply = { status: number; body: Record<string, unknown> } | Error;

function fakeTransport(replies: Reply[]) {
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown>; idempotencyKey?: string }> = [];
  const transport: BillingTransport = {
    async request(req) {
      calls.push(req);
      const next = replies.shift();
      if (!next) throw new Error('unexpected request');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { transport, calls };
}

const fastRetry = { sleep: async () => undefined, baseDelayMs: 0 };

describe('calculateProration', () => {
  const base = {
    currentPlan: { priceId: 'basic', amountMinor: 1000 },
    newPlan: { priceId: 'pro', amountMinor: 3000 },
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
  };

  it('prorates an upgrade half-way through the period', () => {
    expect(calculateProration({ ...base, changeAt: MID })).toEqual({
      creditMinor: 500,
      chargeMinor: 1500,
      netMinor: 1000,
      remainingSeconds: 15 * 86400,
      totalSeconds: 30 * 86400,
    });
  });

  it('produces a negative net (credit) on a downgrade', () => {
    const p = calculateProration({
      ...base,
      currentPlan: base.newPlan,
      newPlan: base.currentPlan,
      changeAt: MID,
    });
    expect(p.netMinor).toBe(-1000);
  });

  it('is a full swap at period start and a no-op at period end', () => {
    expect(calculateProration({ ...base, changeAt: PERIOD_START })).toMatchObject({ creditMinor: 1000, chargeMinor: 3000 });
    expect(calculateProration({ ...base, changeAt: PERIOD_END })).toMatchObject({ creditMinor: 0, chargeMinor: 0, netMinor: 0 });
  });

  it('rounds half-up to whole minor units and scales with quantity', () => {
    const third = PERIOD_START + 2 * 86400; // 28/30 remaining
    expect(calculateProration({ ...base, changeAt: third }).creditMinor).toBe(933); // 933.33
    expect(calculateProration({ ...base, changeAt: third, quantity: 3 }).creditMinor).toBe(2800);
    expect(Number.isInteger(calculateProration({ ...base, changeAt: MID + 1 }).chargeMinor)).toBe(true);
  });

  it.each([
    ['changeAt before period', { changeAt: PERIOD_START - 1 }],
    ['changeAt after period', { changeAt: PERIOD_END + 1 }],
    ['empty period', { periodEnd: PERIOD_START, changeAt: PERIOD_START }],
    ['float price', { currentPlan: { priceId: 'x', amountMinor: 9.5 }, changeAt: MID }],
    ['bad quantity', { quantity: 0, changeAt: MID }],
  ])('rejects %s', (_label, patch) => {
    expect(() => calculateProration({ ...base, ...patch })).toThrow(BillingAdapterError);
  });
});

describe('withIdempotentRetry', () => {
  it('retries retryable errors with exponential backoff and stops on non-retryable', async () => {
    const delays: number[] = [];
    let n = 0;
    const result = await withIdempotentRetry(
      async () => {
        if (++n < 3) throw new BillingAdapterError('RATE_LIMITED', 'stripe', 'slow down', true);
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 100, sleep: async (ms) => void delays.push(ms) },
    );
    expect(result).toBe('ok');
    expect(delays).toEqual([100, 200]);

    let m = 0;
    await expect(
      withIdempotentRetry(async () => {
        m++;
        throw new BillingAdapterError('PROVIDER_REJECTED', 'stripe', 'no', false);
      }, fastRetry),
    ).rejects.toThrow('no');
    expect(m).toBe(1);
  });

  it('gives up after maxAttempts and does not retry unknown errors', async () => {
    let n = 0;
    await expect(
      withIdempotentRetry(async () => {
        n++;
        throw new BillingAdapterError('PROVIDER_UNAVAILABLE', 'stripe', 'down', true);
      }, { ...fastRetry, maxAttempts: 2 }),
    ).rejects.toThrow('down');
    expect(n).toBe(2);
    await expect(withIdempotentRetry(async () => { throw new Error('boom'); }, fastRetry)).rejects.toThrow('boom');
  });
});

describe('createStripeSubscriptionAdapter', () => {
  it('creates a subscription with the idempotency key', async () => {
    const { transport, calls } = fakeTransport([{ status: 200, body: subscription('price_basic', 1000) }]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry });
    const result = await adapter.createSubscription({ idempotencyKey: 'k1', customerId: 'cus_1', priceId: 'price_basic' });
    expect(result).toMatchObject({ subscriptionId: 'sub_1', priceId: 'price_basic', itemId: 'si_1', status: 'active' });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/subscriptions',
      idempotencyKey: 'k1',
      body: { customer: 'cus_1', items: [{ price: 'price_basic', quantity: 1 }] },
    });
  });

  it('changes plan with proration and returns the computed proration', async () => {
    const updated = subscription('price_pro', 3000);
    const { transport, calls } = fakeTransport([
      { status: 200, body: subscription('price_basic', 1000) },
      { status: 200, body: updated },
    ]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry });
    const result = await adapter.changePlan({
      idempotencyKey: 'chg-1',
      subscriptionId: 'sub_1',
      newPriceId: 'price_pro',
      prorationDate: MID,
    });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      path: '/v1/subscriptions/sub_1',
      idempotencyKey: 'chg-1',
      body: { items: [{ id: 'si_1', price: 'price_pro' }], proration_behavior: 'create_prorations', proration_date: MID },
    });
    expect(result.priceId).toBe('price_pro');
    expect(result.proration).toMatchObject({ creditMinor: 500, chargeMinor: 1500, netMinor: 1000 });
  });

  it('skips proration output when behavior is none', async () => {
    const { transport, calls } = fakeTransport([
      { status: 200, body: subscription('price_basic', 1000) },
      { status: 200, body: subscription('price_pro', 3000) },
    ]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry });
    const result = await adapter.changePlan({
      idempotencyKey: 'c', subscriptionId: 'sub_1', newPriceId: 'price_pro', prorationBehavior: 'none',
    });
    expect(result.proration).toBeUndefined();
    expect(calls[1].body).toMatchObject({ proration_behavior: 'none' });
  });

  it('retries a 5xx plan change using the SAME idempotency key', async () => {
    const replies = [
      { status: 200, body: subscription('price_basic', 1000) },
      { status: 429, body: { error: { message: 'slow' } } },
      { status: 200, body: subscription('price_pro', 3000) },
    ];
    const t2 = fakeTransport(replies);
    const adapter = createStripeSubscriptionAdapter({ transport: t2.transport, retry: fastRetry });
    await adapter.changePlan({ idempotencyKey: 'same', subscriptionId: 'sub_1', newPriceId: 'price_pro', prorationDate: MID });
    const posts = t2.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.idempotencyKey)).toEqual(['same', 'same']);
  });

  it('retries transport failures and surfaces PROVIDER_UNAVAILABLE when exhausted', async () => {
    const { transport, calls } = fakeTransport([new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET')]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry });
    await expect(adapter.fetchSubscription('sub_1')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
    expect(calls).toHaveLength(3);
  });

  it('does not retry 4xx rejections', async () => {
    const { transport, calls } = fakeTransport([{ status: 402, body: { error: { message: 'card declined' } } }]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry });
    await expect(adapter.fetchSubscription('sub_1')).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED', message: 'card declined', retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('refuses a no-op plan change and invalid input before changing anything', async () => {
    const { transport, calls } = fakeTransport([{ status: 200, body: subscription('price_pro', 3000) }]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry });
    await expect(
      adapter.changePlan({ idempotencyKey: 'k', subscriptionId: 'sub_1', newPriceId: 'price_pro' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await expect(
      adapter.changePlan({ idempotencyKey: ' ', subscriptionId: 'sub_1', newPriceId: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(adapter.createSubscription({ idempotencyKey: 'k', customerId: '', priceId: 'p' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('previews proration without mutating', async () => {
    const { transport, calls } = fakeTransport([{ status: 200, body: subscription('price_basic', 1000) }]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry, now: () => MID * 1000 });
    const preview = await adapter.previewPlanChange('sub_1', { priceId: 'price_pro', amountMinor: 3000 });
    expect(preview.netMinor).toBe(1000);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('cancels immediately or at period end', async () => {
    const { transport, calls } = fakeTransport([
      { status: 200, body: subscription('p', 1, { status: 'canceled' }) },
      { status: 200, body: subscription('p', 1, { cancel_at_period_end: true }) },
    ]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry });
    expect((await adapter.cancelSubscription({ idempotencyKey: 'a', subscriptionId: 'sub_1' })).status).toBe('canceled');
    expect((await adapter.cancelSubscription({ idempotencyKey: 'b', subscriptionId: 'sub_1', atPeriodEnd: true })).cancelAtPeriodEnd).toBe(true);
    expect(calls[0].path).toBe('/v1/subscriptions/sub_1/cancel');
    expect(calls[1].body).toEqual({ cancel_at_period_end: true });
  });

  it('rejects malformed provider responses', async () => {
    const { transport } = fakeTransport([{ status: 200, body: { id: 'sub_1', status: 'active' } }]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry });
    await expect(adapter.fetchSubscription('sub_1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('emits success and failure telemetry', async () => {
    const events: any[] = [];
    const { transport } = fakeTransport([
      { status: 200, body: subscription('p', 1) },
      { status: 400, body: { error: 'bad' } },
    ]);
    const adapter = createStripeSubscriptionAdapter({ transport, retry: fastRetry, telemetry: { record: (e) => events.push(e) } });
    await adapter.fetchSubscription('sub_1');
    await expect(adapter.fetchSubscription('sub_1')).rejects.toThrow();
    expect(events.map((e) => [e.operation, e.provider, e.outcome, e.errorCode])).toEqual([
      ['fetch', 'stripe', 'success', undefined],
      ['fetch', 'stripe', 'failure', 'PROVIDER_REJECTED'],
    ]);
  });
});
