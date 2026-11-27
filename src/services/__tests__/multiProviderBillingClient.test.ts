import {
  MultiProviderBillingClient,
  multiProviderBillingClient,
  type BillingCheckoutSession,
} from '../multiProviderBillingClient';

describe('MultiProviderBillingClient — Client-Side Strategy Pattern (#2203)', () => {
  let client: MultiProviderBillingClient;

  beforeEach(() => {
    client = new MultiProviderBillingClient();
  });

  describe('getAvailableProviders', () => {
    it('returns all 5 providers when no currency filter is specified', () => {
      const providers = client.getAvailableProviders();
      expect(providers).toHaveLength(5);
      expect(providers.map((p) => p.id)).toEqual(
        expect.arrayContaining(['stripe', 'paypal', 'stellar', 'evm', 'wire_ach'])
      );
    });

    it('filters providers by currency', () => {
      const xlmProviders = client.getAvailableProviders('XLM');
      expect(xlmProviders.map((p) => p.id)).toEqual(['stellar']);

      const ethProviders = client.getAvailableProviders('ETH');
      expect(ethProviders.map((p) => p.id)).toEqual(['evm']);

      const usdProviders = client.getAvailableProviders('USD');
      expect(usdProviders.map((p) => p.id)).toEqual(['stripe', 'paypal', 'wire_ach']);
    });

    it('sets recommendation flag based on wallet availability', () => {
      const noWallet = client.getAvailableProviders('USD', false);
      const stripeNoWallet = noWallet.find((p) => p.id === 'stripe');
      expect(stripeNoWallet?.isRecommended).toBe(true);

      const withWallet = client.getAvailableProviders('XLM', true);
      const stellarWithWallet = withWallet.find((p) => p.id === 'stellar');
      expect(stellarWithWallet?.isRecommended).toBe(true);
    });
  });

  describe('resolveRecommendedProvider', () => {
    it('recommends Stellar when wallet is connected and currency is XLM or USDC', () => {
      const rec = client.resolveRecommendedProvider({
        currency: 'XLM',
        hasConnectedWallet: true,
      });
      expect(rec).toBe('stellar');

      const recUsdc = client.resolveRecommendedProvider({
        currency: 'USDC',
        hasConnectedWallet: true,
      });
      expect(recUsdc).toBe('stellar');
    });

    it('recommends EVM when wallet is connected and currency is ETH', () => {
      const rec = client.resolveRecommendedProvider({
        currency: 'ETH',
        hasConnectedWallet: true,
      });
      expect(rec).toBe('evm');
    });

    it('recommends Stripe for fiat when no wallet is connected', () => {
      const rec = client.resolveRecommendedProvider({
        currency: 'USD',
        hasConnectedWallet: false,
      });
      expect(rec).toBe('stripe');
    });

    it('respects preferredCategory web3', () => {
      const rec = client.resolveRecommendedProvider({
        currency: 'USDC',
        hasConnectedWallet: false,
        preferredCategory: 'web3',
      });
      expect(rec).toBe('stellar');
    });
  });

  describe('estimateTransactionFees', () => {
    it('calculates Stripe fee estimate', () => {
      const est = client.estimateTransactionFees(100, 'USD', 'stripe');
      expect(est.estimatedFee).toBe(3.2);
      expect(est.netAmount).toBe(96.8);
      expect(est.note).toContain('2.9%');
    });

    it('calculates PayPal fee estimate', () => {
      const est = client.estimateTransactionFees(100, 'USD', 'paypal');
      expect(est.estimatedFee).toBe(3.98);
      expect(est.netAmount).toBe(96.02);
      expect(est.note).toContain('3.49%');
    });

    it('calculates Wire/ACH fee with cap', () => {
      const est = client.estimateTransactionFees(2000, 'USD', 'wire_ach');
      expect(est.estimatedFee).toBe(5.0);
      expect(est.netAmount).toBe(1995.0);
      expect(est.note).toContain('capped at $5.00');
    });

    it('calculates Stellar nominal base fee', () => {
      const est = client.estimateTransactionFees(100, 'XLM', 'stellar');
      expect(est.estimatedFee).toBe(0.00001);
      expect(est.note).toContain('100 stroops');
    });

    it('calculates EVM gas fee estimate', () => {
      const est = client.estimateTransactionFees(1, 'ETH', 'evm');
      expect(est.estimatedFee).toBe(0.0015);
      expect(est.note).toContain('EVM');
    });
  });

  describe('initiateCheckout', () => {
    it('rejects invalid or zero amount', async () => {
      const res = await client.initiateCheckout({
        subscriptionId: 'sub_1',
        planId: 'plan_1',
        amount: 0,
        currency: 'USD',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.error).toContain('greater than zero');
    });

    it('requires wallet address for Web3 checkout', async () => {
      const res = await client.initiateCheckout({
        subscriptionId: 'sub_1',
        planId: 'plan_1',
        amount: 50,
        currency: 'XLM',
        preferredProvider: 'stellar',
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.error).toContain('wallet address is required');
    });

    it('completes Web3 checkout with connected wallet', async () => {
      const res = await client.initiateCheckout({
        subscriptionId: 'sub_1',
        planId: 'plan_1',
        amount: 50,
        currency: 'XLM',
        preferredProvider: 'stellar',
        walletAddress: 'GA7QYNF72M7XYTBMM2OZCYGF2H3O5SSJ3LZZ63G57277M2OZCYGF2H3O',
      });
      expect(res.success).toBe(true);
      expect(res.status).toBe('completed');
      expect(res.transactionHash).toBeDefined();
      expect(res.receiptId).toMatch(/^receipt_stellar_/);
    });

    it('uses custom submitter for Web3 transaction when provided', async () => {
      const customSubmitter = jest.fn().mockResolvedValue('0xcustom_signed_tx_hash');
      const customClient = new MultiProviderBillingClient(customSubmitter);

      const res = await customClient.initiateCheckout({
        subscriptionId: 'sub_1',
        planId: 'plan_1',
        amount: 1,
        currency: 'ETH',
        preferredProvider: 'evm',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      });

      expect(res.success).toBe(true);
      expect(res.transactionHash).toBe('0xcustom_signed_tx_hash');
      expect(customSubmitter).toHaveBeenCalled();
    });

    it('handles submitter error gracefully', async () => {
      const failingSubmitter = jest.fn().mockRejectedValue(new Error('User rejected signature'));
      const customClient = new MultiProviderBillingClient(failingSubmitter);

      const res = await customClient.initiateCheckout({
        subscriptionId: 'sub_1',
        planId: 'plan_1',
        amount: 1,
        currency: 'ETH',
        preferredProvider: 'evm',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('User rejected signature');
    });

    it('generates Web2 checkout session URLs for Stripe and PayPal', async () => {
      const stripeRes = await client.initiateCheckout({
        subscriptionId: 'sub_stripe',
        planId: 'plan_pro',
        amount: 29.99,
        currency: 'USD',
        preferredProvider: 'stripe',
      });
      expect(stripeRes.success).toBe(true);
      expect(stripeRes.status).toBe('requires_action');
      expect(stripeRes.sessionUrl).toContain('checkout.stripe.com');

      const paypalRes = await client.initiateCheckout({
        subscriptionId: 'sub_pp',
        planId: 'plan_pro',
        amount: 29.99,
        currency: 'USD',
        preferredProvider: 'paypal',
      });
      expect(paypalRes.success).toBe(true);
      expect(paypalRes.status).toBe('requires_action');
      expect(paypalRes.sessionUrl).toContain('paypal.com');
    });
  });

  describe('verifyPaymentStatus', () => {
    it('verifies payment status properly', async () => {
      const bad = await client.verifyPaymentStatus('stripe', '');
      expect(bad.settled).toBe(false);

      const good = await client.verifyPaymentStatus('stripe', 'ch_123');
      expect(good.settled).toBe(true);
      expect(good.status).toBe('settled_confirmed');

      const ach = await client.verifyPaymentStatus('wire_ach', 'ach_123');
      expect(ach.settled).toBe(true);
      expect(ach.status).toBe('clearing_in_progress');
    });
  });

  describe('Singleton instance export', () => {
    it('exports singleton multiProviderBillingClient', () => {
      expect(multiProviderBillingClient).toBeInstanceOf(MultiProviderBillingClient);
    });
  });
});
