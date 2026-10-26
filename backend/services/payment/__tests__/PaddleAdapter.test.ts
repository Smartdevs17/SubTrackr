import { PaddleAdapter, toPaddleMinorUnits } from '../domain/gateways/PaddleAdapter';
import type {
  PaddleAdapterOptions,
  PaddleFetch,
  PaddleFetchInit,
  PaddleFetchResponse,
} from '../domain/gateways/PaddleAdapter';
import type { PaymentRequest, RefundRequest } from '../interfaces';

interface RecordedCall {
  readonly url: string;
  readonly init: PaddleFetchInit;
}

function body(payload: unknown, status = 200): PaddleFetchResponse {
  const text = JSON.stringify(payload);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function errorBody(status: number, code: string, message: string): PaddleFetchResponse {
  return body({ error: { code, message } }, status);
}

function createFetch(responses: readonly PaddleFetchResponse[]): {
  fetchImpl: PaddleFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl: PaddleFetch = async (url, init) => {
    calls.push({ url, init });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  };
  return { fetchImpl, calls };
}

function createAdapter(
  responses: readonly PaddleFetchResponse[],
  options: Partial<PaddleAdapterOptions> = {},
): { adapter: PaddleAdapter; calls: RecordedCall[] } {
  const { fetchImpl, calls } = createFetch(responses);
  const adapter = new PaddleAdapter({
    apiKey: 'pdl_sdbx_apikey_test',
    environment: 'sandbox',
    fetchImpl,
    maxAttempts: 1,
    retryBaseDelayMs: 0,
    sleep: async () => undefined,
    ...options,
  });
  return { adapter, calls };
}

function paymentRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    amount: 12.99,
    currency: 'USD',
    customerId: 'customer_1',
    paymentMethodId: '',
    idempotencyKey: 'sub_42:2026-09',
    chainType: 'fiat',
    metadata: { paddlePriceId: 'pri_7f4c2a91' },
    ...overrides,
  };
}

function refundRequest(overrides: Partial<RefundRequest> = {}): RefundRequest {
  return {
    chargeId: 'txn_01HQ8Z',
    amount: 12.99,
    reason: 'customer_request',
    ...overrides,
  };
}

function dataOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(call.init.body ?? '{}') as Record<string, unknown>;
}

describe('PaddleAdapter', () => {
  describe('configuration', () => {
    it('registers nothing when no API key is configured', () => {
      expect(PaddleAdapter.fromEnvironment({})).toBeNull();
      expect(PaddleAdapter.fromEnvironment({ PADDLE_API_KEY: '   ' })).toBeNull();
    });

    it('builds an adapter from the environment', () => {
      const adapter = PaddleAdapter.fromEnvironment({
        PADDLE_API_KEY: 'pdl_sdbx_apikey_test',
        PADDLE_ENVIRONMENT: 'sandbox',
      });

      expect(adapter).not.toBeNull();
      expect(adapter?.name).toBe('paddle');
      expect(adapter?.getBaseUrl()).toBe('https://sandbox-api.paddle.com');
    });

    it('uses the production host when asked', () => {
      const adapter = PaddleAdapter.fromEnvironment({
        PADDLE_API_KEY: 'pdl_live_apikey_test',
        PADDLE_ENVIRONMENT: 'production',
      });

      expect(adapter?.getBaseUrl()).toBe('https://api.paddle.com');
    });

    it('falls back to sandbox for an unknown environment', () => {
      const adapter = PaddleAdapter.fromEnvironment({
        PADDLE_API_KEY: 'pdl_sdbx_apikey_test',
        PADDLE_ENVIRONMENT: 'staging',
      });

      expect(adapter?.getBaseUrl()).toBe('https://sandbox-api.paddle.com');
    });

    it('refuses an adapter without an API key', () => {
      expect(() => new PaddleAdapter({ apiKey: '' })).toThrow('paddle');
      expect(() => new PaddleAdapter({ apiKey: '  ' })).toThrow('paddle');
    });

    it('refuses an unknown environment', () => {
      expect(
        () =>
          new PaddleAdapter({
            apiKey: 'pdl_sdbx_apikey_test',
            environment: 'staging' as 'sandbox',
          }),
      ).toThrow('paddle');
    });
  });

  describe('minor units', () => {
    it('converts decimal currencies to cents', () => {
      expect(toPaddleMinorUnits(12.99, 'USD')).toBe(1299);
      expect(toPaddleMinorUnits(0.1, 'EUR')).toBe(10);
    });

    it('passes zero-decimal currencies through unchanged', () => {
      expect(toPaddleMinorUnits(1200, 'JPY')).toBe(1200);
      expect(toPaddleMinorUnits(1200, 'jpy')).toBe(1200);
    });
  });

  describe('charge', () => {
    it('opens a transaction for the catalog price and returns it as a success', async () => {
      const { adapter, calls } = createAdapter([
        body({ data: { id: 'txn_01HQ8Z', status: 'completed', currency_code: 'USD' } }),
      ]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('succeeded');
      expect(result.gatewayUsed).toBe('paddle');
      expect(result.chargeId).toBe('txn_01HQ8Z');
      expect(calls[0].url).toBe('https://sandbox-api.paddle.com/transactions');
      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].init.headers.Authorization).toBe('Bearer pdl_sdbx_apikey_test');
      expect(calls[0].init.headers['Idempotency-Key']).toBe('sub_42:2026-09');
    });

    it('sends the price, currency and SubTrackr correlation data', async () => {
      const { adapter, calls } = createAdapter([
        body({ data: { id: 'txn_1', status: 'completed' } }),
      ]);

      await adapter.charge(
        paymentRequest({ metadata: { paddlePriceId: 'pri_7f4c2a91', paddleCustomerId: 'ctm_9' } }),
      );

      const sent = dataOf(calls[0]) as {
        data: {
          items: Array<{ price_id: string; quantity: number }>;
          currency_code: string;
          collection_mode: string;
          custom_data: Record<string, string>;
          customer: { id: string };
        };
      };
      expect(sent.data.items).toEqual([{ price_id: 'pri_7f4c2a91', quantity: 1 }]);
      expect(sent.data.currency_code).toBe('USD');
      expect(sent.data.collection_mode).toBe('automatic');
      expect(sent.data.custom_data.subtrackr_customer_id).toBe('customer_1');
      expect(sent.data.custom_data.subtrackr_idempotency_key).toBe('sub_42:2026-09');
      expect(sent.data.customer).toEqual({ id: 'ctm_9' });
    });

    it('fails when no Paddle price id is supplied', async () => {
      const { adapter, calls } = createAdapter([body({ data: { id: 'txn_1', status: 'completed' } })]);

      const result = await adapter.charge(paymentRequest({ metadata: {} }));

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('paddle_price_missing');
      expect(calls).toHaveLength(0);
    });

    it('treats a transaction awaiting authentication as pending, not failed', async () => {
      const { adapter } = createAdapter([
        body({ data: { id: 'txn_01HQ8Z', status: 'awaiting_action' } }),
      ]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('pending');
      expect(result.errorMessage).toBe('paddle_transaction_awaiting_action');
    });

    it('treats a ready transaction as pending', async () => {
      const { adapter } = createAdapter([body({ data: { id: 'txn_1', status: 'ready' } })]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('pending');
    });

    it('reports a cancelled transaction as failed', async () => {
      const { adapter } = createAdapter([body({ data: { id: 'txn_1', status: 'cancelled' } })]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('paddle_transaction_cancelled');
    });

    it('surfaces Paddle’s structured error', async () => {
      const { adapter } = createAdapter([
        errorBody(400, 'price_not_found', 'That price does not exist'),
      ]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('paddle_http_400: price_not_found: That price does not exist');
    });

    it('reports an empty response body as a failure', async () => {
      const { adapter } = createAdapter([body({})]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('paddle_empty_response');
    });

    it('reports a non-JSON body as a failure', async () => {
      const { adapter } = createAdapter([
        { ok: true, status: 200, text: async () => '<html>nope</html>' },
      ]);

      const result = await adapter.charge(paymentRequest());

      expect(result.errorMessage).toContain('paddle_invalid_json');
    });
  });

  describe('charge retries', () => {
    it('retries a throttled charge with the same idempotency key', async () => {
      const { fetchImpl, calls } = createFetch([
        errorBody(429, 'rate_limited', 'slow down'),
        body({ data: { id: 'txn_1', status: 'completed' } }),
      ]);
      const adapter = new PaddleAdapter({
        apiKey: 'pdl_sdbx_apikey_test',
        fetchImpl,
        maxAttempts: 3,
        retryBaseDelayMs: 0,
        sleep: async () => undefined,
      });

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('succeeded');
      expect(calls).toHaveLength(2);
      expect(calls[1].init.headers['Idempotency-Key']).toBe('sub_42:2026-09');
    });

    it('retries a 5xx charge', async () => {
      const { fetchImpl, calls } = createFetch([
        errorBody(503, 'unavailable', 'try later'),
        body({ data: { id: 'txn_1', status: 'completed' } }),
      ]);
      const adapter = new PaddleAdapter({
        apiKey: 'pdl_sdbx_apikey_test',
        fetchImpl,
        maxAttempts: 2,
        retryBaseDelayMs: 0,
        sleep: async () => undefined,
      });

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('succeeded');
      expect(calls).toHaveLength(2);
    });

    it('gives up after the configured number of attempts', async () => {
      const { fetchImpl, calls } = createFetch([errorBody(500, 'boom', 'boom')]);
      const adapter = new PaddleAdapter({
        apiKey: 'pdl_sdbx_apikey_test',
        fetchImpl,
        maxAttempts: 3,
        retryBaseDelayMs: 0,
        sleep: async () => undefined,
      });

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('paddle_http_500');
      expect(calls).toHaveLength(3);
    });

    it('reports a transport failure after exhausting the retries', async () => {
      const fetchImpl: PaddleFetch = async () => {
        throw new Error('socket hang up');
      };
      const adapter = new PaddleAdapter({
        apiKey: 'pdl_sdbx_apikey_test',
        fetchImpl,
        maxAttempts: 2,
        retryBaseDelayMs: 0,
        sleep: async () => undefined,
      });

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('paddle_transport_error');
    });
  });

  describe('refund', () => {
    it('refunds a transaction with the amount in minor units', async () => {
      const { adapter, calls } = createAdapter([
        body({ data: { id: 'rfn_01', status: 'completed', amount: 1299 } }),
      ]);

      const result = await adapter.refund(refundRequest());

      expect(result.status).toBe('succeeded');
      expect(result.chargeId).toBe('txn_01HQ8Z');
      expect(calls[0].url).toBe('https://sandbox-api.paddle.com/transactions/txn_01HQ8Z/refunds');
      expect((dataOf(calls[0]) as { data: { amount: number } }).data.amount).toBe(1299);
    });

    it('prefers an explicit transaction id from metadata', async () => {
      const { adapter, calls } = createAdapter([body({ data: { id: 'rfn_01', status: 'completed' } })]);

      await adapter.refund(
        refundRequest({
          chargeId: 'txn_fallback',
          metadata: { paddleTransactionId: 'txn_explicit', paddleCurrency: 'EUR' },
        }),
      );

      expect(calls[0].url).toContain('/transactions/txn_explicit/refunds');
    });

    it('reports a still-settling refund as pending', async () => {
      const { adapter } = createAdapter([body({ data: { id: 'rfn_01', status: 'pending' } })]);

      const result = await adapter.refund(refundRequest());

      expect(result.status).toBe('pending');
    });

    it('fails when no transaction id is available', async () => {
      const { adapter, calls } = createAdapter([body({ data: { id: 'rfn_01' } })]);

      const result = await adapter.refund({ chargeId: '', amount: 5 });

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('paddle_transaction_missing');
      expect(calls).toHaveLength(0);
    });

    it('rejects a non-positive refund amount without calling Paddle', async () => {
      const { adapter, calls } = createAdapter([body({ data: { id: 'rfn_01' } })]);

      const result = await adapter.refund(refundRequest({ amount: 0 }));

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('paddle_amount_invalid');
      expect(calls).toHaveLength(0);
    });

    it('never retries a refund', async () => {
      const { fetchImpl, calls } = createFetch([errorBody(500, 'boom', 'boom')]);
      const adapter = new PaddleAdapter({
        apiKey: 'pdl_sdbx_apikey_test',
        fetchImpl,
        maxAttempts: 3,
        retryBaseDelayMs: 0,
        sleep: async () => undefined,
      });

      await adapter.refund(refundRequest());

      expect(calls).toHaveLength(1);
    });
  });

  describe('createCustomer', () => {
    it('creates a Paddle customer', async () => {
      const { adapter, calls } = createAdapter([
        body({ data: { id: 'ctm_01HQ8Z', email: 'ada@example.com' } }),
      ]);

      const result = await adapter.createCustomer('ada@example.com', 'Ada Lovelace');

      expect(result).toEqual({
        id: 'ctm_01HQ8Z',
        gatewayCustomerId: 'ctm_01HQ8Z',
        gatewayUsed: 'paddle',
      });
      expect((dataOf(calls[0]) as { data: { email: string; name: string } }).data).toEqual({
        email: 'ada@example.com',
        name: 'Ada Lovelace',
      });
    });

    it('raises on a Paddle error', async () => {
      const { adapter } = createAdapter([errorBody(422, 'email_taken', 'Already in use')]);

      await expect(adapter.createCustomer('ada@example.com', 'Ada')).rejects.toThrow(
        'email_taken: Already in use',
      );
    });

    it('raises when the response carries no customer', async () => {
      const { adapter } = createAdapter([body({ data: {} })]);

      await expect(adapter.createCustomer('ada@example.com', 'Ada')).rejects.toThrow(
        'paddle_empty_response',
      );
    });

    it('never retries customer creation', async () => {
      const { fetchImpl, calls } = createFetch([errorBody(500, 'boom', 'boom')]);
      const adapter = new PaddleAdapter({
        apiKey: 'pdl_sdbx_apikey_test',
        fetchImpl,
        maxAttempts: 3,
        retryBaseDelayMs: 0,
        sleep: async () => undefined,
      });

      await expect(adapter.createCustomer('ada@example.com', 'Ada')).rejects.toThrow('paddle');
      expect(calls).toHaveLength(1);
    });
  });

  describe('getPaymentMethod', () => {
    it('reads the card summary from the transaction', async () => {
      const { adapter, calls } = createAdapter([
        body({
          data: {
            id: 'txn_01HQ8Z',
            status: 'completed',
            payment_method_details: {
              type: 'card',
              card: { last4: '4242', expiry_month: 12, expiry_year: 2030, brand: 'visa' },
            },
          },
        }),
      ]);

      const result = await adapter.getPaymentMethod('txn_01HQ8Z');

      expect(result).toEqual({
        id: 'txn_01HQ8Z',
        type: 'card',
        last4: '4242',
        expiryMonth: 12,
        expiryYear: 2030,
        gatewayUsed: 'paddle',
      });
      expect(calls[0].init.method).toBe('GET');
    });

    it('rejects a standalone payment method id, which Paddle does not expose', async () => {
      const { adapter, calls } = createAdapter([body({ data: {} })]);

      await expect(adapter.getPaymentMethod('pm_01HQ8Z')).rejects.toThrow(
        'paddle_payment_method_not_supported',
      );
      expect(calls).toHaveLength(0);
    });

    it('raises when the transaction carries no payment method', async () => {
      const { adapter } = createAdapter([body({ data: { id: 'txn_01HQ8Z', status: 'completed' } })]);

      await expect(adapter.getPaymentMethod('txn_01HQ8Z')).rejects.toThrow(
        'paddle_payment_method_not_found',
      );
    });

    it('requires an id', async () => {
      const { adapter } = createAdapter([body({ data: {} })]);

      await expect(adapter.getPaymentMethod('')).rejects.toThrow('paddle');
    });
  });

  describe('createPayout', () => {
    it('reports payouts as unsupported so the router falls through', async () => {
      const { adapter } = createAdapter([]);

      const result = await adapter.createPayout({
        amount: 500,
        currency: 'USD',
        destination: 'bank_account_1',
      });

      expect(result.status).toBe('failed');
      expect(result.payoutId).toBe('');
      expect(result.gatewayUsed).toBe('paddle');
      expect(result.errorMessage).toContain('paddle_payouts_unsupported');
    });
  });

  describe('runtime without fetch', () => {
    it('reports an unavailable transport instead of throwing', async () => {
      const originalFetch = (globalThis as { fetch?: unknown }).fetch;
      (globalThis as { fetch?: unknown }).fetch = undefined;
      try {
        const adapter = new PaddleAdapter({ apiKey: 'pdl_sdbx_apikey_test' });
        const result = await adapter.charge(paymentRequest());

        expect(result.status).toBe('failed');
        expect(result.errorMessage).toContain('paddle_fetch_unavailable');
      } finally {
        (globalThis as { fetch?: unknown }).fetch = originalFetch;
      }
    });
  });
});
