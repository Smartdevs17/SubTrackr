import { PaymentRouter } from '../domain/PaymentRouter';
import { StripeAdapter } from '../domain/gateways/StripeAdapter';
import { CircleAdapter } from '../domain/gateways/CircleAdapter';

describe('PaymentRouter', () => {
  let router: PaymentRouter;

  beforeEach(() => {
    router = new PaymentRouter();
    router.registerGateway('stripe', new StripeAdapter());
    router.registerGateway('circle', new CircleAdapter());
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
        amount: 1000, currency: 'usd', customerId: 'merchant-1',
        paymentMethodId: 'pm_123', idempotencyKey: 'ik_1',
      });
      expect(result.status).toBe('succeeded');
      expect(result.gatewayUsed).toBe('stripe');
    });
  });

  describe('setMerchantConfig / getMerchantConfig', () => {
    it('sets and retrieves merchant config', () => {
      router.setMerchantConfig('merchant-2', { primary: 'circle', secondary: 'stripe' });
      const config = router.getMerchantConfig('merchant-2');
      expect(config).toEqual({ primary: 'circle', secondary: 'stripe' });
    });
  });
});
