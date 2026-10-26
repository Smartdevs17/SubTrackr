import {
  FeeBumpService,
  InMemoryFeeBumpStore,
  TestnetStellarClient,
  type MerchantFeeBumpConfig,
  type FeeBumpRequest,
  type StellarNetworkClient,
} from '../feeBumpService';

describe('FeeBumpService — Issue #1712', () => {
  let store: InMemoryFeeBumpStore;
  let service: FeeBumpService;

  const merchantConfig: MerchantFeeBumpConfig = {
    merchantId: 'merchant-abc',
    feeBumpEnabled: true,
    sponsorAddress: 'GABC123STELLARADDRESS',
    maxFeeStroops: 100,
  };

  const request: FeeBumpRequest = {
    merchantId: 'merchant-abc',
    subscriberId: 'sub-xyz',
    innerTransactionXdr: 'AAAAAQAAAA...',
  };

  beforeEach(() => {
    store = new InMemoryFeeBumpStore();
    service = new FeeBumpService(store, new TestnetStellarClient(), 'testnet');
  });

  // ── configureMerchant ──────────────────────────────────────────────────

  describe('configureMerchant', () => {
    it('persists a merchant config', async () => {
      await service.configureMerchant(merchantConfig);
      const stored = await service.getMerchantConfig('merchant-abc');
      expect(stored).toMatchObject(merchantConfig);
    });

    it('allows updating an existing config', async () => {
      await service.configureMerchant(merchantConfig);
      await service.configureMerchant({ ...merchantConfig, feeBumpEnabled: false });
      const stored = await service.getMerchantConfig('merchant-abc');
      expect(stored?.feeBumpEnabled).toBe(false);
    });

    it('throws when merchantId is missing', async () => {
      await expect(
        service.configureMerchant({ ...merchantConfig, merchantId: '' }),
      ).rejects.toThrow('merchantId is required');
    });

    it('throws when sponsorAddress is missing', async () => {
      await expect(
        service.configureMerchant({ ...merchantConfig, sponsorAddress: '' }),
      ).rejects.toThrow('sponsorAddress is required');
    });

    it('throws when maxFeeStroops is negative', async () => {
      await expect(
        service.configureMerchant({ ...merchantConfig, maxFeeStroops: -1 }),
      ).rejects.toThrow('maxFeeStroops must be non-negative');
    });
  });

  // ── opt-in check ─────────────────────────────────────────────────────

  describe('sponsorTransaction — opt-in check', () => {
    it('returns error when merchant not configured', async () => {
      const result = await service.sponsorTransaction(request);
      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/not enabled/i);
    });

    it('returns error when feeBumpEnabled is false', async () => {
      await service.configureMerchant({ ...merchantConfig, feeBumpEnabled: false });
      const result = await service.sponsorTransaction(request);
      expect(result.success).toBe(false);
      expect(result.errorMessage).toMatch(/not enabled/i);
    });
  });

  // ── successful sponsorship ────────────────────────────────────────────

  describe('sponsorTransaction — success path', () => {
    beforeEach(async () => {
      await service.configureMerchant(merchantConfig);
    });

    it('returns success with tx hashes and fee', async () => {
      const result = await service.sponsorTransaction(request);
      expect(result.success).toBe(true);
      expect(result.feeBumpTransactionHash).toBeDefined();
      expect(result.innerTransactionHash).toBeDefined();
      expect(result.feeStroops).toBeGreaterThan(0);
    });

    it('records the sponsorship for accounting', async () => {
      await service.sponsorTransaction(request);
      const records = await service.getAccountingRecords('merchant-abc');
      expect(records).toHaveLength(1);
      expect(records[0].merchantId).toBe('merchant-abc');
      expect(records[0].subscriberId).toBe('sub-xyz');
      expect(records[0].network).toBe('testnet');
    });

    it('uses request maxFeeStroops when provided', async () => {
      const mockClient: StellarNetworkClient = {
        submitFeeBump: jest.fn(async (p) => ({
          feeBumpHash: 'hash1',
          innerHash: 'inner1',
          feeStroops: p.maxFeeStroops,
        })),
      };
      const svc = new FeeBumpService(store, mockClient, 'testnet');
      await svc.sponsorTransaction({ ...request, maxFeeStroops: 200 });
      expect(mockClient.submitFeeBump).toHaveBeenCalledWith(
        expect.objectContaining({ maxFeeStroops: 200 }),
      );
    });

    it('falls back to config maxFeeStroops when not in request', async () => {
      const mockClient: StellarNetworkClient = {
        submitFeeBump: jest.fn(async (p) => ({
          feeBumpHash: 'hash1',
          innerHash: 'inner1',
          feeStroops: p.maxFeeStroops,
        })),
      };
      const svc = new FeeBumpService(store, mockClient, 'testnet');
      await service.configureMerchant({ ...merchantConfig, maxFeeStroops: 150 });
      await svc.sponsorTransaction(request);
      expect(mockClient.submitFeeBump).toHaveBeenCalledWith(
        expect.objectContaining({ maxFeeStroops: 150 }),
      );
    });

    it('accumulates multiple records across transactions', async () => {
      await service.sponsorTransaction(request);
      await service.sponsorTransaction({ ...request, subscriberId: 'sub-yyy' });
      const records = await service.getAccountingRecords('merchant-abc');
      expect(records).toHaveLength(2);
    });
  });

  // ── error handling ───────────────────────────────────────────────────

  describe('sponsorTransaction — Stellar client error', () => {
    it('returns failure result (no exception) when Stellar throws', async () => {
      const failingClient: StellarNetworkClient = {
        submitFeeBump: jest.fn().mockRejectedValue(new Error('Network timeout')),
      };
      const svc = new FeeBumpService(store, failingClient, 'testnet');
      await svc.configureMerchant(merchantConfig);
      const result = await svc.sponsorTransaction(request);
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe('Network timeout');
    });

    it('does not write an accounting record on Stellar failure', async () => {
      const failingClient: StellarNetworkClient = {
        submitFeeBump: jest.fn().mockRejectedValue(new Error('tx_failed')),
      };
      const svc = new FeeBumpService(store, failingClient, 'testnet');
      await svc.configureMerchant(merchantConfig);
      await svc.sponsorTransaction(request);
      const records = await svc.getAccountingRecords('merchant-abc');
      expect(records).toHaveLength(0);
    });
  });

  // ── getAccountingRecords ─────────────────────────────────────────────

  describe('getAccountingRecords', () => {
    it('isolates records per merchant', async () => {
      await service.configureMerchant(merchantConfig);
      await service.configureMerchant({
        ...merchantConfig,
        merchantId: 'merchant-other',
        sponsorAddress: 'GOTHER',
      });

      await service.sponsorTransaction(request);
      await service.sponsorTransaction({ ...request, merchantId: 'merchant-other' });

      const recordsAbc = await service.getAccountingRecords('merchant-abc');
      const recordsOther = await service.getAccountingRecords('merchant-other');
      expect(recordsAbc).toHaveLength(1);
      expect(recordsOther).toHaveLength(1);
    });

    it('returns empty array for merchant with no records', async () => {
      const records = await service.getAccountingRecords('unknown-merchant');
      expect(records).toHaveLength(0);
    });
  });

  // ── TestnetStellarClient ─────────────────────────────────────────────

  describe('TestnetStellarClient', () => {
    it('returns deterministic inner hash from XDR', async () => {
      const client = new TestnetStellarClient();
      const r1 = await client.submitFeeBump({
        sponsorAddress: 'GABC',
        innerTransactionXdr: 'XDR1',
        maxFeeStroops: 100,
        network: 'testnet',
      });
      const r2 = await client.submitFeeBump({
        sponsorAddress: 'GABC',
        innerTransactionXdr: 'XDR1',
        maxFeeStroops: 100,
        network: 'testnet',
      });
      expect(r1.innerHash).toBe(r2.innerHash);
    });

    it('caps fee at maxFeeStroops (max 100)', async () => {
      const client = new TestnetStellarClient();
      const result = await client.submitFeeBump({
        sponsorAddress: 'GABC',
        innerTransactionXdr: 'XDR',
        maxFeeStroops: 50,
        network: 'testnet',
      });
      expect(result.feeStroops).toBeLessThanOrEqual(50);
    });
  });
});
