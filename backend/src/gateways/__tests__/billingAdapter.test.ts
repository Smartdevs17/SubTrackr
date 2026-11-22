import {
  BillingAdapterError,
  createBillingAdapter,
  createConsoleBillingTelemetry,
  listBillingAdapters,
  noopBillingTelemetry,
  type BillingMoney,
  type BillingTransport,
  type BillingTransportRequest,
  type BillingTransportResponse,
} from '../billingAdapter';

// ── Fakes ─────────────────────────────────────────────────────────────────────

const AMOUNT: BillingMoney = { amountMinor: 1999, currency: 'USD' };

function response(body: Record<string, unknown>, status = 200): BillingTransportResponse {
  return { status, body };
}

const STRIPE_CHARGE = {
  id: 'pi_123',
  status: 'succeeded',
  amount: 1999,
  currency: 'usd',
  created: 1_700_000_000,
};

const PAYPAL_CHARGE = {
  id: 'ORDER-123',
  status: 'COMPLETED',
  create_time: '2023-11-14T22:13:20Z',
};

const PADDLE_CHARGE = {
  data: {
    id: 'txn_123',
    status: 'completed',
    amount: 1999,
    currency: 'USD',
    created_at: '2023-11-14T22:13:20Z',
  },
};

function fakeTransport(
  body: Record<string, unknown> = STRIPE_CHARGE,
  status = 200,
): { transport: BillingTransport; calls: BillingTransportRequest[] } {
  const calls: BillingTransportRequest[] = [];
  return {
    calls,
    transport: {
      async request(request) {
        calls.push(request);
        return response(body, status);
      },
    },
  };
}

function chargeRequest(overrides: Partial<Parameters<ReturnType<typeof createBillingAdapter>['charge']>[0]> = {}) {
  return {
    idempotencyKey: 'charge-1',
    amount: AMOUNT,
    customerId: 'cus_1',
    ...overrides,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

describe('createBillingAdapter', () => {
  it('exposes every registered provider', () => {
    expect(listBillingAdapters()).toEqual(['stripe', 'paypal', 'paddle']);
  });

  it('creates an adapter per provider', () => {
    for (const provider of listBillingAdapters()) {
      const adapter = createBillingAdapter(provider, { transport: fakeTransport().transport });
      expect(adapter.provider).toBe(provider);
      expect(typeof adapter.charge).toBe('function');
      expect(typeof adapter.refund).toBe('function');
      expect(typeof adapter.fetchCharge).toBe('function');
    }
  });

  it('rejects an unknown provider instead of silently falling back', () => {
    expect(() =>
      createBillingAdapter('unknown' as never, { transport: fakeTransport().transport }),
    ).toThrow(BillingAdapterError);
  });
});

// ── Normalised charge results ────────────────────────────────────────────────

describe('BillingAdapter.charge', () => {
  it('normalises a Stripe response', async () => {
    const { transport, calls } = fakeTransport(STRIPE_CHARGE);
    const adapter = createBillingAdapter('stripe', { transport, now: () => 1000 });

    const result = await adapter.charge(chargeRequest());

    expect(result).toEqual({
      ok: true,
      operation: 'charge',
      provider: 'stripe',
      providerChargeId: 'pi_123',
      status: 'succeeded',
      amount: AMOUNT,
      createdAt: '2023-11-14T22:13:20.000Z',
    });
    expect(calls[0].path).toBe('/v1/payment_intents');
    expect(calls[0].idempotencyKey).toBe('charge-1');
    expect(calls[0].body).toMatchObject({ amount: 1999, currency: 'usd' });
  });

  it('normalises a PayPal response', async () => {
    const { transport, calls } = fakeTransport(PAYPAL_CHARGE);
    const adapter = createBillingAdapter('paypal', { transport });

    const result = await adapter.charge(chargeRequest());

    expect(result.provider).toBe('paypal');
    expect(result.status).toBe('succeeded');
    expect(result.providerChargeId).toBe('ORDER-123');
    expect(calls[0].path).toBe('/v2/checkout/orders');
  });

  it('normalises a Paddle response with a data envelope', async () => {
    const { transport } = fakeTransport(PADDLE_CHARGE);
    const adapter = createBillingAdapter('paddle', { transport });

    const result = await adapter.charge(chargeRequest());

    expect(result.provider).toBe('paddle');
    expect(result.providerChargeId).toBe('txn_123');
    expect(result.amount).toEqual(AMOUNT);
  });

  it('maps provider-specific pending statuses to the shared vocabulary', async () => {
    const { transport } = fakeTransport({ ...PAYPAL_CHARGE, status: 'APPROVED' });
    const adapter = createBillingAdapter('paypal', { transport });

    expect((await adapter.charge(chargeRequest())).status).toBe('requires_action');
  });

  it('rejects fractional and non-positive amounts', async () => {
    const adapter = createBillingAdapter('stripe', { transport: fakeTransport().transport });

    await expect(adapter.charge(chargeRequest({ amount: { amountMinor: 10.5, currency: 'USD' } })))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(adapter.charge(chargeRequest({ amount: { amountMinor: 0, currency: 'USD' } })))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects a lowercase or malformed currency', async () => {
    const adapter = createBillingAdapter('stripe', { transport: fakeTransport().transport });

    await expect(adapter.charge(chargeRequest({ amount: { amountMinor: 100, currency: 'usd' } })))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('requires an idempotency key', async () => {
    const adapter = createBillingAdapter('stripe', { transport: fakeTransport().transport });

    await expect(adapter.charge(chargeRequest({ idempotencyKey: '  ' }))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});

// ── Refunds ───────────────────────────────────────────────────────────────────

describe('BillingAdapter.refund', () => {
  const STRIPE_REFUND = {
    id: 're_123',
    status: 'succeeded',
    amount: 500,
    created: 1_700_000_000,
  };

  it('normalises a refund and forwards the idempotency key', async () => {
    const { transport, calls } = fakeTransport(STRIPE_REFUND);
    const adapter = createBillingAdapter('stripe', { transport });

    const result = await adapter.refund({
      idempotencyKey: 'refund-1',
      providerChargeId: 'pi_123',
      amount: { amountMinor: 500, currency: 'USD' },
      reason: 'duplicate',
    });

    expect(result).toMatchObject({
      operation: 'refund',
      providerRefundId: 're_123',
      providerChargeId: 'pi_123',
      status: 'succeeded',
    });
    expect(calls[0].idempotencyKey).toBe('refund-1');
    expect(calls[0].body).toMatchObject({ payment_intent: 'pi_123', reason: 'duplicate' });
  });

  it('requires a provider charge id', async () => {
    const adapter = createBillingAdapter('stripe', { transport: fakeTransport().transport });

    await expect(
      adapter.refund({ idempotencyKey: 'r', providerChargeId: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

// ── Error classification ──────────────────────────────────────────────────────

describe('provider error classification', () => {
  const cases: Array<[number, string, boolean]> = [
    [429, 'RATE_LIMITED', true],
    [503, 'PROVIDER_UNAVAILABLE', true],
    [402, 'PROVIDER_REJECTED', false],
    [404, 'UNKNOWN', false],
  ];

  it.each(cases)('maps HTTP %i to %s (retryable=%s)', async (status, code, retryable) => {
    const { transport } = fakeTransport({ error: { message: 'boom' } }, status);
    const adapter = createBillingAdapter('stripe', { transport });

    await expect(adapter.charge(chargeRequest())).rejects.toMatchObject({
      code,
      retryable,
      provider: 'stripe',
    });
  });

  it('wraps transport failures as retryable provider outages', async () => {
    const transport: BillingTransport = {
      async request() {
        throw new Error('ECONNRESET');
      },
    };
    const adapter = createBillingAdapter('stripe', { transport });

    await expect(adapter.charge(chargeRequest())).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });

  it('rejects malformed provider payloads as INVALID_RESPONSE', async () => {
    const { transport } = fakeTransport({ status: 'succeeded' });
    const adapter = createBillingAdapter('stripe', { transport });

    await expect(adapter.charge(chargeRequest())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

// ── Observability ─────────────────────────────────────────────────────────────

describe('billing telemetry', () => {
  it('emits success and failure events with the error code', async () => {
    const events: Array<{ outcome: string; errorCode?: string; durationMs: number }> = [];
    const telemetry = {
      record(event: { outcome: string; errorCode?: string; durationMs: number }) {
        events.push(event);
      },
    };
    const ok = createBillingAdapter('stripe', {
      transport: fakeTransport(STRIPE_CHARGE).transport,
      telemetry,
      now: () => 42,
    });
    const failing = createBillingAdapter('stripe', {
      transport: fakeTransport({}, 500).transport,
      telemetry,
      now: () => 42,
    });

    await ok.charge(chargeRequest());
    await expect(failing.charge(chargeRequest())).rejects.toBeDefined();

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ outcome: 'success', durationMs: 0 });
    expect(events[1]).toMatchObject({ outcome: 'failure', errorCode: 'PROVIDER_UNAVAILABLE' });
  });

  it('provides a no-op and a console-backed telemetry sink', () => {
    expect(() => noopBillingTelemetry.record({} as never)).not.toThrow();

    const error = jest.fn();
    createConsoleBillingTelemetry({ error, warn: jest.fn() } as never).record({
      operation: 'charge',
      provider: 'stripe',
      outcome: 'failure',
      durationMs: 1,
      errorCode: 'RATE_LIMITED',
    });
    expect(error).toHaveBeenCalled();
  });
});
