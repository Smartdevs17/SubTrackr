import { PaymentRouter } from '../domain/PaymentRouter';
import { StripeAdapter } from '../domain/gateways/StripeAdapter';
import { CircleAdapter } from '../domain/gateways/CircleAdapter';
import { StellarAdapter } from '../domain/gateways/StellarAdapter';
import type { PaymentRoutingStrategy } from '../domain/PaymentRouter';
import type {
  IPaymentGateway,
  PaymentRequest,
  PaymentResult,
  RefundRequest,
  RefundResult,
} from '../interfaces';

function createPaymentGateway(
  name: string,
  handlers: {
    charge?: (request: PaymentRequest) => Promise<PaymentResult>;
    refund?: (request: RefundRequest) => Promise<RefundResult>;
  } = {},
): IPaymentGateway {
  return {
    name,
    charge:
      handlers.charge ??
      jest.fn(async (request: PaymentRequest) => ({
        id: `${name}_charge`,
        status: 'succeeded',
        amount: request.amount,
        currency: request.currency,
        gatewayUsed: name,
        chargeId: `${name}_charge`,
        processedAt: new Date().toISOString(),
      })),
    refund:
      handlers.refund ??
      jest.fn(async (request: RefundRequest) => ({
        id: `${name}_refund`,
        chargeId: request.chargeId,
        status: 'succeeded',
        amount: request.amount ?? 0,
        gatewayUsed: name,
        processedAt: new Date().toISOString(),
      })),
    createCustomer: jest.fn(async () => ({
      id: `${name}_customer`,
      gatewayCustomerId: `${name}_customer`,
      gatewayUsed: name,
    })),
    getPaymentMethod: jest.fn(async (paymentMethodId: string) => ({
      id: paymentMethodId,
      type: 'card',
      gatewayUsed: name,
    })),
    createPayout: jest.fn(async request => ({
      id: `${name}_payout`,
      status: 'succeeded',
      amount: request.amount,
      currency: request.currency,
      gatewayUsed: name,
      payoutId: `${name}_payout`,
      processedAt: new Date().toISOString(),
    })),
  };
}

describe('PaymentRouter', () => {
  let router: PaymentRouter;

  beforeEach(() => {
    router = new PaymentRouter();
    router.registerGateway('stripe', new StripeAdapter());
    router.registerGateway('circle', new CircleAdapter());
    router.registerGateway('stellar', new StellarAdapter());
  });

  describe('registerGateway', () => {
    it('registers a gateway', () => {
      const gateway = router.getGateway('stripe');
      expect(gateway.name).toBe('stripe');
    });

    it('throws for unregistered gateway', () => {
      expect(() => router.getGateway('unknown')).toThrow('not found');
    });
  });

  describe('charge', () => {
    it('charges via primary gateway', async () => {
      router.setMerchantConfig('merchant-1', { primary: 'stripe', secondary: 'circle' });
      const result = await router.charge({
        amount: 1000,
        currency: 'usd',
        customerId: 'merchant-1',
        paymentMethodId: 'pm_123',
        idempotencyKey: 'ik_1',
      });
      expect(result.status).toBe('succeeded');
      expect(result.gatewayUsed).toBe('stripe');
    });

    it('routes USDC EVM payments through Circle by default', async () => {
      const result = await router.charge({
        amount: 1000,
        currency: 'USDC',
        customerId: 'merchant-evm',
        paymentMethodId: 'pm_usdc',
        idempotencyKey: 'ik_usdc',
        chainType: 'evm',
        chainId: 137,
      });

      expect(result.status).toBe('succeeded');
      expect(result.gatewayUsed).toBe('circle');
    });

    it('routes Stellar payments through the Stellar gateway first', async () => {
      const result = await router.charge({
        amount: 25,
        currency: 'XLM',
        customerId: 'merchant-stellar',
        paymentMethodId: 'GDESTINATION',
        idempotencyKey: 'ik_xlm',
        chainType: 'stellar',
      });

      expect(result.status).toBe('succeeded');
      expect(result.gatewayUsed).toBe('stellar');
    });

    it('infers Stellar routing from XLM currency', async () => {
      const result = await router.charge({
        amount: 25,
        currency: 'xlm',
        customerId: 'merchant-stellar',
        paymentMethodId: 'GDESTINATION',
        idempotencyKey: 'ik_xlm_currency',
      });

      expect(result.gatewayUsed).toBe('stellar');
    });

    it('uses metadata chain type when the request field is omitted', async () => {
      const result = await router.charge({
        amount: 25,
        currency: 'USD',
        customerId: 'merchant-stellar',
        paymentMethodId: 'GDESTINATION',
        idempotencyKey: 'ik_metadata_chain',
        metadata: { chainType: 'stellar' },
      });

      expect(result.gatewayUsed).toBe('stellar');
    });

    it('honors merchant chain overrides before generic fallback order', async () => {
      router.setMerchantConfig('merchant-2', {
        primary: 'stripe',
        secondary: 'circle',
        chainOverrides: { stellar: ['stellar'] },
      });

      const result = await router.charge({
        amount: 25,
        currency: 'USD',
        customerId: 'merchant-2',
        paymentMethodId: 'GDESTINATION',
        idempotencyKey: 'ik_override',
        chainType: 'stellar',
      });

      expect(result.gatewayUsed).toBe('stellar');
    });

    it('allows custom routing strategies', async () => {
      const strategy: PaymentRoutingStrategy = {
        name: 'test-circle-first',
        resolveChargeGateways: () => ['circle', 'stripe'],
      };
      router.setRoutingStrategy(strategy);

      const result = await router.charge({
        amount: 10,
        currency: 'USDC',
        customerId: 'merchant-custom',
        paymentMethodId: 'pm_usdc',
        idempotencyKey: 'ik_custom',
      });

      expect(result.gatewayUsed).toBe('circle');
    });

    it('skips unknown strategy gateways and falls back to registered gateways', async () => {
      const strategy: PaymentRoutingStrategy = {
        name: 'unknown-first',
        resolveChargeGateways: () => ['missing', 'circle'],
      };
      router.setRoutingStrategy(strategy);

      const result = await router.charge({
        amount: 10,
        currency: 'USDC',
        customerId: 'merchant-unknown',
        paymentMethodId: 'pm_usdc',
        idempotencyKey: 'ik_unknown',
      });

      expect(result.gatewayUsed).toBe('circle');
    });

    it('tries fallback gateways after a declined charge', async () => {
      const failingGateway = createPaymentGateway('failing', {
        charge: jest.fn(async request => ({
          id: 'failed_charge',
          status: 'failed',
          amount: request.amount,
          currency: request.currency,
          gatewayUsed: 'failing',
          chargeId: 'failed_charge',
          errorMessage: 'declined',
          processedAt: new Date().toISOString(),
        })),
      });
      const backupGateway = createPaymentGateway('backup');
      router = new PaymentRouter({
        name: 'fallback-test',
        resolveChargeGateways: () => ['failing', 'backup'],
      });
      router.registerGateway('failing', failingGateway);
      router.registerGateway('backup', backupGateway);

      const result = await router.charge({
        amount: 10,
        currency: 'USD',
        customerId: 'merchant-fallback',
        paymentMethodId: 'pm_card',
        idempotencyKey: 'ik_fallback',
      });

      expect(failingGateway.charge).toHaveBeenCalledTimes(1);
      expect(backupGateway.charge).toHaveBeenCalledTimes(1);
      expect(result.gatewayUsed).toBe('backup');
    });

    it('throws when every selected gateway fails', async () => {
      router = new PaymentRouter({
        name: 'all-fail',
        resolveChargeGateways: () => ['throws', 'declines'],
      });
      router.registerGateway(
        'throws',
        createPaymentGateway('throws', {
          charge: jest.fn(async () => {
            throw new Error('network unavailable');
          }),
        }),
      );
      router.registerGateway(
        'declines',
        createPaymentGateway('declines', {
          charge: jest.fn(async request => ({
            id: 'declined_charge',
            status: 'failed',
            amount: request.amount,
            currency: request.currency,
            gatewayUsed: 'declines',
            chargeId: 'declined_charge',
            errorMessage: 'insufficient funds',
            processedAt: new Date().toISOString(),
          })),
        }),
      );

      await expect(
        router.charge({
          amount: 10,
          currency: 'USD',
          customerId: 'merchant-fail',
          paymentMethodId: 'pm_card',
          idempotencyKey: 'ik_fail',
        }),
      ).rejects.toThrow('All gateways failed');
    });
  });

  describe('setMerchantConfig / getMerchantConfig', () => {
    it('sets and retrieves merchant config', () => {
      router.setMerchantConfig('merchant-2', { primary: 'circle', secondary: 'stripe' });
      const config = router.getMerchantConfig('merchant-2');
      expect(config).toEqual({ primary: 'circle', secondary: 'stripe' });
    });

    it('returns undefined for merchants without config', () => {
      expect(router.getMerchantConfig('merchant-missing')).toBeUndefined();
    });
  });

  describe('refund', () => {
    it('refunds through the first successful gateway', async () => {
      const result = await router.refund({
        chargeId: 'charge_123',
        amount: 500,
        reason: 'requested_by_customer',
      });

      expect(result.status).toBe('succeeded');
      expect(result.gatewayUsed).toBe('stripe');
      expect(result.amount).toBe(500);
    });

    it('tries refund fallback gateways after a declined refund', async () => {
      const failingGateway = createPaymentGateway('failing', {
        refund: jest.fn(async request => ({
          id: 'failed_refund',
          chargeId: request.chargeId,
          status: 'failed',
          amount: request.amount ?? 0,
          gatewayUsed: 'failing',
          errorMessage: 'refund declined',
          processedAt: new Date().toISOString(),
        })),
      });
      const backupGateway = createPaymentGateway('backup');
      router = new PaymentRouter();
      router.registerGateway('failing', failingGateway);
      router.registerGateway('backup', backupGateway);

      const result = await router.refund({ chargeId: 'charge_123', amount: 500 });

      expect(failingGateway.refund).toHaveBeenCalledTimes(1);
      expect(backupGateway.refund).toHaveBeenCalledTimes(1);
      expect(result.gatewayUsed).toBe('backup');
    });

    it('throws when every refund gateway fails', async () => {
      router = new PaymentRouter();
      router.registerGateway(
        'throws',
        createPaymentGateway('throws', {
          refund: jest.fn(async () => {
            throw new Error('refund network unavailable');
          }),
        }),
      );
      router.registerGateway(
        'declines',
        createPaymentGateway('declines', {
          refund: jest.fn(async request => ({
            id: 'declined_refund',
            chargeId: request.chargeId,
            status: 'failed',
            amount: request.amount ?? 0,
            gatewayUsed: 'declines',
            errorMessage: 'refund denied',
            processedAt: new Date().toISOString(),
          })),
        }),
      );

      await expect(router.refund({ chargeId: 'charge_123', amount: 500 })).rejects.toThrow(
        'All gateways refund failed',
      );
    });
  });
});
