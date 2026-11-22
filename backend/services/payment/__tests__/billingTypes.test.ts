import type {
  GatewayConfig,
  IPaymentGateway,
  IPaymentRouter,
  PaymentRequest,
  PaymentResult,
  PaymentSplit,
} from '@subtrackr/billing-types';
import type { PaymentRequest as LegacyPaymentRequest } from '../interfaces';

describe('@subtrackr/billing-types', () => {
  it('provides the same canonical request through the compatibility export', () => {
    const request: PaymentRequest = {
      amount: 25,
      currency: 'USD',
      customerId: 'customer-1',
      paymentMethodId: 'payment-method-1',
      idempotencyKey: 'charge-1',
      splits: [{ destinationAccountId: 'merchant-1', percentage: 100 }],
    } satisfies LegacyPaymentRequest;

    expect(request.splits).toEqual([
      { destinationAccountId: 'merchant-1', percentage: 100 },
    ] satisfies PaymentSplit[]);
  });

  it('exposes compatible gateway and router contracts', () => {
    const gateway: IPaymentGateway = {
      name: 'test',
      charge: async (): Promise<PaymentResult> => ({
        id: 'charge-1', status: 'succeeded', amount: 25, currency: 'USD',
        gatewayUsed: 'test', chargeId: 'charge-1', processedAt: new Date(0).toISOString(),
      }),
      refund: async () => ({
        id: 'refund-1', chargeId: 'charge-1', status: 'succeeded', amount: 25,
        gatewayUsed: 'test', processedAt: new Date(0).toISOString(),
      }),
      createCustomer: async () => ({ id: 'customer-1', gatewayCustomerId: 'remote-1', gatewayUsed: 'test' }),
      getPaymentMethod: async () => ({ id: 'pm-1', type: 'card', gatewayUsed: 'test' }),
      createPayout: async () => ({
        id: 'payout-1', status: 'succeeded', amount: 25, currency: 'USD', gatewayUsed: 'test',
        payoutId: 'payout-1', processedAt: new Date(0).toISOString(),
      }),
    };
    const router: IPaymentRouter = {
      charge: (request) => gateway.charge(request),
      refund: (request) => gateway.refund(request),
      getGateway: () => gateway,
      registerGateway: () => undefined,
    };
    const config: GatewayConfig = { primary: 'stripe', secondary: 'stellar' };

    expect(router.getGateway(config.primary)).toBe(gateway);
  });
});
