import { ShopifyAdapter } from '../domain/gateways/ShopifyAdapter';
import type {
  ShopifyAdapterOptions,
  ShopifyFetch,
  ShopifyFetchInit,
  ShopifyFetchResponse,
} from '../domain/gateways/ShopifyAdapter';
import type { PaymentRequest, RefundRequest } from '../interfaces';

interface RecordedCall {
  readonly url: string;
  readonly init: ShopifyFetchInit;
}

function body(payload: unknown, status = 200): ShopifyFetchResponse {
  const text = JSON.stringify(payload);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function raw(text: string, status = 200): ShopifyFetchResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

function createFetch(responses: readonly ShopifyFetchResponse[]): {
  fetchImpl: ShopifyFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl: ShopifyFetch = async (url, init) => {
    calls.push({ url, init });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  };
  return { fetchImpl, calls };
}

function createAdapter(
  responses: readonly ShopifyFetchResponse[],
  options: Partial<ShopifyAdapterOptions> = {},
): { adapter: ShopifyAdapter; calls: RecordedCall[] } {
  const { fetchImpl, calls } = createFetch(responses);
  const adapter = new ShopifyAdapter({
    shopDomain: 'subtrackr.myshopify.com',
    accessToken: 'shpat_test_token',
    apiVersion: '2025-07',
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
    paymentMethodId: 'gid://shopify/CustomerPaymentMethod/9',
    idempotencyKey: 'sub_42:2026-09',
    metadata: { shopifyContractId: 'gid://shopify/SubscriptionContract/42' },
    ...overrides,
  };
}

function refundRequest(overrides: Partial<RefundRequest> = {}): RefundRequest {
  return {
    chargeId: 'gid://shopify/Order/77',
    amount: 12.99,
    reason: 'customer_request',
    ...overrides,
  };
}

function billingAttempt(ready: boolean) {
  return {
    data: {
      subscriptionBillingAttemptCreate: {
        subscriptionBillingAttempt: { id: 'gid://shopify/SubscriptionBillingAttempt/1', ready },
        userErrors: [],
      },
    },
  };
}

function variablesOf(call: RecordedCall): Record<string, unknown> {
  return JSON.parse(call.init.body).variables as Record<string, unknown>;
}

describe('ShopifyAdapter', () => {
  describe('configuration', () => {
    it('registers nothing when the shop is not configured', () => {
      expect(ShopifyAdapter.fromEnvironment({})).toBeNull();
      expect(
        ShopifyAdapter.fromEnvironment({ SHOPIFY_SHOP_DOMAIN: 'subtrackr.myshopify.com' }),
      ).toBeNull();
      expect(
        ShopifyAdapter.fromEnvironment({ SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test_token' }),
      ).toBeNull();
    });

    it('builds an adapter from the environment when both values are present', () => {
      const adapter = ShopifyAdapter.fromEnvironment({
        SHOPIFY_SHOP_DOMAIN: 'subtrackr.myshopify.com',
        SHOPIFY_ADMIN_ACCESS_TOKEN: 'shpat_test_token',
        SHOPIFY_API_VERSION: '2024-10',
      });

      expect(adapter).not.toBeNull();
      expect(adapter?.name).toBe('shopify');
    });

    it('refuses an adapter without credentials', () => {
      expect(() => new ShopifyAdapter({ shopDomain: '', accessToken: 'shpat_test_token' })).toThrow(
        'shopify',
      );
      expect(() =>
        new ShopifyAdapter({ shopDomain: 'subtrackr.myshopify.com', accessToken: '  ' }),
      ).toThrow('shopify');
    });
  });

  describe('charge', () => {
    it('creates an idempotent billing attempt on the subscription contract', async () => {
      const { adapter, calls } = createAdapter([body(billingAttempt(true))]);

      const result = await adapter.charge(paymentRequest());

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        'https://subtrackr.myshopify.com/admin/api/2025-07/graphql.json',
      );
      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].init.headers['X-Shopify-Access-Token']).toBe('shpat_test_token');
      expect(calls[0].init.headers['Idempotency-Key']).toBe('sub_42:2026-09');

      const variables = variablesOf(calls[0]);
      expect(variables.subscriptionContractId).toBe('gid://shopify/SubscriptionContract/42');
      expect(variables.subscriptionBillingAttemptInput).toMatchObject({
        idempotencyKey: 'sub_42:2026-09',
      });
      expect(
        (variables.subscriptionBillingAttemptInput as { originTime: string }).originTime,
      ).toEqual(expect.any(String));

      expect(result.status).toBe('succeeded');
      expect(result.gatewayUsed).toBe('shopify');
      expect(result.amount).toBe(12.99);
      expect(result.currency).toBe('USD');
      expect(result.chargeId).toBe('gid://shopify/SubscriptionBillingAttempt/1');
      expect(result.processedAt).toEqual(expect.any(String));
    });

    it('reports an attempt Shopify has not settled as pending', async () => {
      const { adapter } = createAdapter([body(billingAttempt(false))]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('pending');
      expect(result.chargeId).toBe('gid://shopify/SubscriptionBillingAttempt/1');
      expect(result.errorMessage).toBeUndefined();
    });

    it('fails without calling Shopify when the contract is missing', async () => {
      const { adapter, calls } = createAdapter([body(billingAttempt(true))]);

      const result = await adapter.charge(paymentRequest({ metadata: {} }));

      expect(calls).toHaveLength(0);
      expect(result.status).toBe('failed');
      expect(result.gatewayUsed).toBe('shopify');
      expect(result.errorMessage).toContain('shopify_contract_missing');
    });

    it('surfaces Shopify userErrors as a failure', async () => {
      const { adapter } = createAdapter([
        body({
          data: {
            subscriptionBillingAttemptCreate: {
              subscriptionBillingAttempt: null,
              userErrors: [{ field: ['input'], message: 'Contract is not active', code: 'INACTIVE' }],
            },
          },
        }),
      ]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('shopify_user_error: Contract is not active');
    });

    it('fails when the mutation returns no attempt', async () => {
      const { adapter } = createAdapter([
        body({ data: { subscriptionBillingAttemptCreate: { subscriptionBillingAttempt: null } } }),
      ]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('shopify_empty_response');
    });

    it('maps a GraphQL error to a failure', async () => {
      const { adapter } = createAdapter([
        body({ errors: [{ message: 'Access denied for subscriptionContractCreate field.' }] }),
      ]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe(
        'shopify_graphql_error: Access denied for subscriptionContractCreate field.',
      );
    });

    it('reports an HTTP failure with the response body', async () => {
      const { adapter } = createAdapter([raw('Unauthorized', 401)]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('shopify_http_401: Unauthorized');
    });

    it('reports a body that is not JSON', async () => {
      const { adapter } = createAdapter([raw('<html>gateway error</html>', 200)]);

      const result = await adapter.charge(paymentRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('shopify_invalid_json');
    });

    it('retries a throttle or an outage, because the attempt is idempotent', async () => {
      const { adapter, calls } = createAdapter(
        [raw('rate limited', 429), raw('bad gateway', 502), body(billingAttempt(true))],
        { maxAttempts: 3 },
      );

      const result = await adapter.charge(paymentRequest());

      expect(calls).toHaveLength(3);
      expect(result.status).toBe('succeeded');
    });

    it('reports a transport failure after exhausting the retries', async () => {
      let attempts = 0;
      const { adapter } = createAdapter([], {
        maxAttempts: 3,
        retryBaseDelayMs: 0,
        sleep: async () => undefined,
        fetchImpl: async () => {
          attempts += 1;
          throw new Error('socket hang up');
        },
      });

      const result = await adapter.charge(paymentRequest());

      expect(attempts).toBe(3);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('shopify_transport_error: socket hang up');
    });
  });

  describe('refund', () => {
    it('refunds the Shopify order behind the charge', async () => {
      const { adapter, calls } = createAdapter([
        body({ data: { refundCreate: { refund: { id: 'gid://shopify/Refund/5' }, userErrors: [] } } }),
      ]);

      const result = await adapter.refund(refundRequest());

      const variables = variablesOf(calls[0]) as { input: Record<string, unknown> };
      expect(variables.input.orderId).toBe('gid://shopify/Order/77');
      expect(variables.input.transactions).toEqual([
        {
          orderId: 'gid://shopify/Order/77',
          gateway: 'shopify_payments',
          kind: 'REFUND',
          amount: '12.99',
        },
      ]);

      expect(result.status).toBe('succeeded');
      expect(result.id).toBe('gid://shopify/Refund/5');
      expect(result.chargeId).toBe('gid://shopify/Order/77');
      expect(result.amount).toBe(12.99);
    });

    it('accepts the order id from metadata', async () => {
      const { adapter, calls } = createAdapter([
        body({ data: { refundCreate: { refund: { id: 'gid://shopify/Refund/6' }, userErrors: [] } } }),
      ]);

      await adapter.refund(
        refundRequest({ chargeId: 'sub_42:2026-09', metadata: { shopifyOrderId: 'gid://shopify/Order/88' } }),
      );

      const variables = variablesOf(calls[0]) as { input: Record<string, unknown> };
      expect(variables.input.orderId).toBe('gid://shopify/Order/88');
    });

    it('does not retry a refund, so a customer cannot be refunded twice', async () => {
      const { adapter, calls } = createAdapter([raw('bad gateway', 502)], { maxAttempts: 3 });

      const result = await adapter.refund(refundRequest());

      expect(calls).toHaveLength(1);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('shopify_http_502: bad gateway');
    });

    it('fails without calling Shopify when there is no order id', async () => {
      const { adapter, calls } = createAdapter([]);

      const result = await adapter.refund(refundRequest({ chargeId: '' }));

      expect(calls).toHaveLength(0);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('shopify_order_missing');
    });

    it('surfaces Shopify userErrors as a failure', async () => {
      const { adapter } = createAdapter([
        body({
          data: {
            refundCreate: {
              refund: null,
              userErrors: [{ field: ['input', 'transactions'], message: 'Refund exceeds balance' }],
            },
          },
        }),
      ]);

      const result = await adapter.refund(refundRequest());

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('shopify_user_error: Refund exceeds balance');
    });
  });

  describe('createCustomer', () => {
    it('creates a Shopify customer from the port arguments', async () => {
      const { adapter, calls } = createAdapter([
        body({ data: { customerCreate: { customer: { id: 'gid://shopify/Customer/3' }, userErrors: [] } } }),
      ]);

      const result = await adapter.createCustomer('ada@example.com', 'Ada Lovelace');

      const variables = variablesOf(calls[0]) as { input: Record<string, unknown> };
      expect(variables.input).toEqual({
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });
      expect(result).toEqual({
        id: 'gid://shopify/Customer/3',
        gatewayCustomerId: 'gid://shopify/Customer/3',
        gatewayUsed: 'shopify',
      });
    });

    it('handles a single-word name', async () => {
      const { adapter, calls } = createAdapter([
        body({ data: { customerCreate: { customer: { id: 'gid://shopify/Customer/4' }, userErrors: [] } } }),
      ]);

      await adapter.createCustomer('ada@example.com', 'Ada');

      const variables = variablesOf(calls[0]) as { input: Record<string, unknown> };
      expect(variables.input.firstName).toBe('Ada');
      expect(variables.input.lastName).toBeUndefined();
    });

    it('raises a gateway error on userErrors', async () => {
      const { adapter } = createAdapter([
        body({
          data: {
            customerCreate: {
              customer: null,
              userErrors: [{ field: ['input', 'email'], message: 'Email has already been taken' }],
            },
          },
        }),
      ]);

      await expect(adapter.createCustomer('ada@example.com', 'Ada')).rejects.toThrow(
        'shopify_user_error: Email has already been taken',
      );
    });

    it('raises a gateway error when no customer comes back', async () => {
      const { adapter } = createAdapter([
        body({ data: { customerCreate: { customer: null, userErrors: [] } } }),
      ]);

      await expect(adapter.createCustomer('ada@example.com', 'Ada')).rejects.toThrow(
        'shopify_empty_response',
      );
    });
  });

  describe('getPaymentMethod', () => {
    it('maps a stored card to the port shape', async () => {
      const { adapter, calls } = createAdapter([
        body({
          data: {
            customerPaymentMethod: {
              id: 'gid://shopify/CustomerPaymentMethod/9',
              instrument: {
                brand: 'VISA',
                lastDigits: '4242',
                expiryMonth: 8,
                expiryYear: 2029,
              },
            },
          },
        }),
      ]);

      const result = await adapter.getPaymentMethod('gid://shopify/CustomerPaymentMethod/9');

      expect(variablesOf(calls[0])).toEqual({ id: 'gid://shopify/CustomerPaymentMethod/9' });
      expect(result).toEqual({
        id: 'gid://shopify/CustomerPaymentMethod/9',
        type: 'visa',
        last4: '4242',
        expiryMonth: 8,
        expiryYear: 2029,
        gatewayUsed: 'shopify',
      });
    });

    it('raises a gateway error for an unknown payment method', async () => {
      const { adapter } = createAdapter([
        body({ data: { customerPaymentMethod: null } }),
      ]);

      await expect(adapter.getPaymentMethod('gid://shopify/CustomerPaymentMethod/999')).rejects.toThrow(
        'shopify_payment_method_not_found',
      );
    });
  });

  describe('createPayout', () => {
    it('reports payouts as unsupported instead of faking one', async () => {
      const { adapter, calls } = createAdapter([]);

      const result = await adapter.createPayout({
        amount: 100,
        currency: 'USD',
        destination: 'shop_bank_account',
      });

      expect(calls).toHaveLength(0);
      expect(result.status).toBe('failed');
      expect(result.gatewayUsed).toBe('shopify');
      expect(result.payoutId).toBe('');
      expect(result.errorMessage).toContain('shopify_payouts_unsupported');
    });
  });
});
