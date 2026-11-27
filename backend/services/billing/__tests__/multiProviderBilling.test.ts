import {
  BillingProviderRegistry,
  EVMBillingStrategy,
  MultiProviderBillingEngine,
  PayPalBillingStrategy,
  StellarBillingStrategy,
  StripeBillingStrategy,
  validateEVMAddress,
  validateStellarAddress,
  WireAchBillingStrategy,
  type BillingChargeRequest,
  type BillingProviderStrategy,
} from '../multiProviderBillingStrategy';

const STELLAR_ADDRESS = 'GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O';
const EVM_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';

describe('Multi-Provider Billing Strategy Architecture (#2203)', () => {
  let registry: BillingProviderRegistry;
  let engine: MultiProviderBillingEngine;

  beforeEach(() => {
    registry = new BillingProviderRegistry();
    engine = new MultiProviderBillingEngine(registry);
  });

  describe('Address Validators', () => {
    it('validates Stellar addresses correctly', () => {
      expect(validateStellarAddress(STELLAR_ADDRESS)).toBe(true);
      expect(validateStellarAddress('0x123456')).toBe(false);
      expect(validateStellarAddress(STELLAR_ADDRESS.slice(0, 50))).toBe(false);
      expect(validateStellarAddress('B' + STELLAR_ADDRESS.slice(1))).toBe(false);
      expect(validateStellarAddress(STELLAR_ADDRESS + '1')).toBe(false);
      expect(validateStellarAddress(null as any)).toBe(false);
    });

    it('validates EVM addresses correctly', () => {
      expect(validateEVMAddress(EVM_ADDRESS)).toBe(true);
      expect(validateEVMAddress(EVM_ADDRESS.toLowerCase())).toBe(true);
      expect(validateEVMAddress('0x12345')).toBe(false);
      expect(validateEVMAddress('1234567890abcdef1234567890abcdef12345678')).toBe(false);
      expect(validateEVMAddress('0x' + 'g'.repeat(40))).toBe(false);
      expect(validateEVMAddress(null as any)).toBe(false);
    });
  });

  describe('StripeBillingStrategy', () => {
    const stripe = new StripeBillingStrategy();

    it('has correct capabilities and category', () => {
      expect(stripe.providerId).toBe('stripe');
      expect(stripe.category).toBe('web2');
      expect(stripe.capabilities.recurring).toBe(true);
      expect(stripe.capabilities.onChainSettlement).toBe(false);
    });

    it('validates charge request parameters', () => {
      const validReq: BillingChargeRequest = {
        id: 'req_1',
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
        amount: 29.99,
        currency: 'USD',
      };
      expect(stripe.validateParams(validReq).valid).toBe(true);

      const invalidReq: BillingChargeRequest = {
        id: '',
        subscriptionId: '',
        customerId: '',
        amount: -5,
        currency: 'UNSUPPORTED',
      };
      const res = stripe.validateParams(invalidReq);
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThanOrEqual(4);
    });

    it('calculates standard fees properly', () => {
      const { fee, netAmount } = stripe.calculateFee(100, 'USD');
      expect(fee).toBe(3.2); // 2.9% of 100 = 2.9 + 0.3 = 3.2
      expect(netAmount).toBe(96.8);
    });

    it('executes successful charge with proof', async () => {
      const res = await stripe.executeCharge({
        id: 'req_1',
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
        amount: 50,
        currency: 'USD',
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe('settled');
      expect(res.chargeId).toMatch(/^ch_stripe_/);
      expect(res.settlementProof).toBeDefined();
    });

    it('returns failure for invalid charge request', async () => {
      const res = await stripe.executeCharge({
        id: '',
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
        amount: 0,
        currency: 'USD',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.errorCode).toBe('VALIDATION_FAILED');
    });

    it('executes refund and verifies webhook and health', async () => {
      const ref = await stripe.executeRefund({ chargeId: 'ch_1', amount: 20 });
      expect(ref.success).toBe(true);
      expect(ref.status).toBe('completed');

      const hook = await stripe.verifyWebhook('payload', { 'stripe-signature': 'sig' });
      expect(hook.verified).toBe(true);

      const badHook = await stripe.verifyWebhook('payload', {});
      expect(badHook.verified).toBe(false);

      const health = await stripe.getHealth();
      expect(health.healthy).toBe(true);
    });
  });

  describe('PayPalBillingStrategy', () => {
    const paypal = new PayPalBillingStrategy();

    it('calculates fees and executes charge and refund', async () => {
      expect(paypal.category).toBe('web2');
      const { fee } = paypal.calculateFee(100, 'USD');
      expect(fee).toBe(3.98); // 3.49 + 0.49

      const charge = await paypal.executeCharge({
        id: 'pp_1',
        subscriptionId: 'sub_pp',
        customerId: 'user_1',
        amount: 25,
        currency: 'USD',
      });
      expect(charge.success).toBe(true);
      expect(charge.providerId).toBe('paypal');
      expect(charge.settlementProof).toMatch(/^paypal_order_/);

      const refund = await paypal.executeRefund({ chargeId: charge.chargeId, amount: 25 });
      expect(refund.success).toBe(true);

      const hook = await paypal.verifyWebhook('payload', { 'paypal-auth-algo': 'SHA256' });
      expect(hook.verified).toBe(true);

      const badHook = await paypal.verifyWebhook('payload', {});
      expect(badHook.verified).toBe(false);
    });
  });

  describe('WireAchBillingStrategy', () => {
    const ach = new WireAchBillingStrategy();

    it('validates routing number and caps fee at $5', async () => {
      const { fee } = ach.calculateFee(1000, 'USD');
      expect(fee).toBe(5.0); // 1000 * 0.008 = $8 -> capped at $5

      const invalidReq: BillingChargeRequest = {
        id: 'ach_1',
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
        amount: 100,
        currency: 'USD',
        bankDetails: {
          routingNumber: '123', // invalid
          accountNumber: '12', // too short
        },
      };
      const val = ach.validateParams(invalidReq);
      expect(val.valid).toBe(false);
      expect(val.errors).toContain('Invalid 9-digit ACH routing number');
      expect(val.errors).toContain('Bank account number must be at least 4 digits');

      const validReq: BillingChargeRequest = {
        ...invalidReq,
        bankDetails: {
          routingNumber: '123456789',
          accountNumber: '12345678',
        },
      };
      const charge = await ach.executeCharge(validReq);
      expect(charge.success).toBe(true);
      expect(charge.status).toBe('pending'); // ACH multi-day clearing
    });
  });

  describe('StellarBillingStrategy', () => {
    const stellar = new StellarBillingStrategy();

    it('has Web3 capabilities and validates G... recipient', async () => {
      expect(stellar.category).toBe('web3');
      expect(stellar.capabilities.onChainSettlement).toBe(true);

      const invalid = stellar.validateParams({
        id: 'req_xlm',
        subscriptionId: 'sub_1',
        customerId: 'user_1',
        amount: 100,
        currency: 'XLM',
        walletAddress: '0xinvalid',
      });
      expect(invalid.valid).toBe(false);

      const valid = stellar.validateParams({
        id: 'req_xlm',
        subscriptionId: 'sub_1',
        customerId: 'user_1',
        amount: 100,
        currency: 'XLM',
        walletAddress: STELLAR_ADDRESS,
      });
      expect(valid.valid).toBe(true);

      const charge = await stellar.executeCharge({
        id: 'req_xlm',
        subscriptionId: 'sub_1',
        customerId: 'user_1',
        amount: 100,
        currency: 'XLM',
        walletAddress: STELLAR_ADDRESS,
      });
      expect(charge.success).toBe(true);
      expect(charge.status).toBe('settled');
      expect(charge.transactionHash).toMatch(/^stellar_tx_/);
      expect(charge.settlementProof).toMatch(/^ledger_seq_/);
    });
  });

  describe('EVMBillingStrategy', () => {
    const evm = new EVMBillingStrategy();

    it('has Web3 capabilities and executes on-chain charge', async () => {
      expect(evm.category).toBe('web3');
      const valid = evm.validateParams({
        id: 'req_evm',
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
        amount: 1.5,
        currency: 'ETH',
        walletAddress: EVM_ADDRESS,
      });
      expect(valid.valid).toBe(true);

      const charge = await evm.executeCharge({
        id: 'req_evm',
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
        amount: 1.5,
        currency: 'ETH',
        walletAddress: EVM_ADDRESS,
      });
      expect(charge.success).toBe(true);
      expect(charge.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    });
  });

  describe('BillingProviderRegistry', () => {
    it('manages registered providers and categories', () => {
      expect(registry.has('stripe')).toBe(true);
      expect(registry.has('stellar')).toBe(true);
      expect(registry.has('paypal')).toBe(true);

      const web2s = registry.getByCategory('web2');
      expect(web2s.map((p) => p.providerId)).toEqual(
        expect.arrayContaining(['stripe', 'paypal', 'wire_ach'])
      );

      const web3s = registry.getByCategory('web3');
      expect(web3s.map((p) => p.providerId)).toEqual(
        expect.arrayContaining(['stellar', 'evm'])
      );

      const xlmProviders = registry.getByCurrency('XLM');
      expect(xlmProviders.some((p) => p.providerId === 'stellar')).toBe(true);

      expect(registry.getDefault('web2').providerId).toBe('stripe');
      expect(registry.getDefault('web3').providerId).toBe('stellar');

      registry.setDefault('web2', 'paypal');
      expect(registry.getDefault('web2').providerId).toBe('paypal');
    });

    it('supports custom strategy registration and unregistration', () => {
      const mockCustom: BillingProviderStrategy = {
        providerId: 'custom_gateway',
        category: 'web2',
        capabilities: {
          recurring: true,
          usageBased: false,
          refunds: true,
          disputes: false,
          webhooks: false,
          onChainSettlement: false,
          immediateSettlement: true,
          idempotent: true,
        },
        supportedCurrencies: ['USD'],
        validateParams: () => ({ valid: true, errors: [] }),
        calculateFee: (amt) => ({ fee: 1, netAmount: amt - 1, currency: 'USD' }),
        executeCharge: async (req) => ({
          success: true,
          chargeId: 'custom_1',
          subscriptionId: req.subscriptionId,
          providerId: 'custom_gateway',
          amount: req.amount,
          currency: req.currency,
          fee: 1,
          netAmount: req.amount - 1,
          status: 'settled',
          timestamp: Date.now(),
        }),
        executeRefund: async (req) => ({
          success: true,
          refundId: 'ref_custom',
          chargeId: req.chargeId,
          amount: req.amount || 0,
          status: 'completed',
          timestamp: Date.now(),
        }),
        verifyWebhook: async () => ({ verified: true }),
        getHealth: async () => ({ healthy: true, latencyMs: 10 }),
      };

      registry.register(mockCustom);
      expect(registry.has('custom_gateway')).toBe(true);
      expect(registry.unregister('custom_gateway')).toBe(true);
      expect(registry.has('custom_gateway')).toBe(false);
    });
  });

  describe('MultiProviderBillingEngine', () => {
    it('intelligently resolves provider based on explicit choice, address, or currency', () => {
      // 1. Explicit
      expect(
        engine.resolveProvider({
          id: '1',
          subscriptionId: 's',
          customerId: 'c',
          amount: 10,
          currency: 'USD',
          providerId: 'paypal',
        }).providerId
      ).toBe('paypal');

      // 2. Stellar address
      expect(
        engine.resolveProvider({
          id: '2',
          subscriptionId: 's',
          customerId: 'c',
          amount: 10,
          currency: 'USD',
          walletAddress: STELLAR_ADDRESS,
        }).providerId
      ).toBe('stellar');

      // 3. EVM address
      expect(
        engine.resolveProvider({
          id: '3',
          subscriptionId: 's',
          customerId: 'c',
          amount: 10,
          currency: 'USD',
          walletAddress: EVM_ADDRESS,
        }).providerId
      ).toBe('evm');

      // 4. Crypto currency XLM
      expect(
        engine.resolveProvider({
          id: '4',
          subscriptionId: 's',
          customerId: 'c',
          amount: 10,
          currency: 'XLM',
        }).providerId
      ).toBe('stellar');

      // 5. Crypto currency ETH
      expect(
        engine.resolveProvider({
          id: '5',
          subscriptionId: 's',
          customerId: 'c',
          amount: 10,
          currency: 'ETH',
        }).providerId
      ).toBe('evm');

      // 6. Default fiat
      expect(
        engine.resolveProvider({
          id: '6',
          subscriptionId: 's',
          customerId: 'c',
          amount: 10,
          currency: 'USD',
        }).providerId
      ).toBe('stripe');
    });

    it('processes charges and updates analytics', async () => {
      const res = await engine.charge({
        id: 'req_ch_1',
        subscriptionId: 'sub_ch_1',
        customerId: 'cus_1',
        amount: 100,
        currency: 'USD',
      });
      expect(res.success).toBe(true);

      const stats = engine.getAnalytics();
      expect(stats.totalProcessed).toBe(1);
      expect(stats.totalVolume).toBe(100);
      expect(stats.successCount).toBe(1);
      expect(stats.providerBreakdown['stripe']?.successes).toBe(1);
    });

    it('charges with fallback routing when primary provider fails', async () => {
      // Create a mock failing primary strategy
      const failingStripe: BillingProviderStrategy = {
        ...new StripeBillingStrategy(),
        executeCharge: async (req) => ({
          success: false,
          chargeId: 'fail_1',
          subscriptionId: req.subscriptionId,
          providerId: 'stripe',
          amount: req.amount,
          currency: req.currency,
          fee: 0,
          netAmount: 0,
          status: 'failed',
          errorCode: 'NETWORK_TIMEOUT',
          errorMessage: 'Stripe gateway unreachable',
          timestamp: Date.now(),
        }),
      };
      registry.register(failingStripe);

      const res = await engine.chargeWithFallback(
        {
          id: 'req_fb_1',
          subscriptionId: 'sub_fb',
          customerId: 'cus_fb',
          amount: 50,
          currency: 'USD',
        },
        ['paypal']
      );

      expect(res.success).toBe(true);
      expect(res.providerId).toBe('paypal');
      expect(res.attempts?.length).toBe(2);
      expect(res.attempts?.[0].providerId).toBe('stripe');
      expect(res.attempts?.[0].success).toBe(false);
      expect(res.attempts?.[1].providerId).toBe('paypal');
      expect(res.attempts?.[1].success).toBe(true);

      const stats = engine.getAnalytics();
      expect(stats.fallbackCount).toBe(1);
    });

    it('reports exhausted fallback chain when all providers fail', async () => {
      const res = await engine.chargeWithFallback(
        {
          id: 'req_fail',
          subscriptionId: 'sub_fail',
          customerId: 'cus_fail',
          amount: -10, // will fail validation on all
          currency: 'INVALID',
        },
        ['paypal', 'wire_ach']
      );

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('ALL_PROVIDERS_FAILED');
      expect(res.attempts?.length).toBeGreaterThanOrEqual(1);
    });

    it('processes refund and checks health across all providers', async () => {
      const ref = await engine.refund({
        chargeId: 'ch_123',
        providerId: 'stripe',
        amount: 50,
      });
      expect(ref.success).toBe(true);

      const notFound = await engine.refund({
        chargeId: 'ch_123',
        providerId: 'non_existent_provider',
      });
      expect(notFound.success).toBe(false);
      expect(notFound.errorCode).toBe('PROVIDER_NOT_FOUND');

      const health = await engine.checkAllProviderHealth();
      expect(health.stripe.healthy).toBe(true);
      expect(health.stellar.healthy).toBe(true);
    });
  });
});
