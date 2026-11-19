/**
 * Tests for QuickBooks OAuth and Sync services.
 */

import { QuickBooksOAuthService, type QuickBooksCredentials } from '../QuickBooksOAuthService';
import { QuickBooksSyncService, type SubTrackrCustomer, type SubTrackrInvoice, type SubTrackrPayment, type SubTrackrPlan } from '../QuickBooksSyncService';

// ── Helpers ────────────────────────────────────────────────────────────────────

const TEST_CREDENTIALS: QuickBooksCredentials = {
  clientId: 'test_client_id',
  clientSecret: 'test_client_secret',
  redirectUri: 'http://localhost:3000/callback',
  environment: 'sandbox',
};

function makeTokenResponse(overrides: Partial<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}> = {}) {
  return {
    access_token: overrides.access_token ?? 'access_tok_001',
    refresh_token: overrides.refresh_token ?? 'refresh_tok_001',
    expires_in: overrides.expires_in ?? 3600,
    x_refresh_token_expires_in: overrides.x_refresh_token_expires_in ?? 8726400,
    token_type: 'bearer',
  };
}

function mockFetchWithJson(body: unknown, status = 200): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function makeCustomer(id = 'cust_001'): SubTrackrCustomer {
  return {
    id,
    email: `user+${id}@example.com`,
    displayName: `Test User ${id}`,
    phone: '+15555550000',
    addressLine1: '123 Main St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94105',
    country: 'US',
  };
}

function makePlan(id = 'plan_001'): SubTrackrPlan {
  return {
    id,
    name: 'Pro Plan',
    description: 'Monthly Pro subscription',
    price: 49.99,
    currency: 'USD',
    billingCycle: 'monthly',
  };
}

function makeInvoice(id = 'inv_001', customerId = 'cust_001'): SubTrackrInvoice {
  return {
    id,
    subscriptionId: 'sub_001',
    subscriptionName: 'Pro Plan',
    customerId,
    amount: 49.99,
    currency: 'USD',
    issuedAt: '2026-09-01T00:00:00Z',
    dueAt: '2026-09-15T00:00:00Z',
    status: 'open',
    customerEmail: 'user@example.com',
  };
}

function makePayment(id = 'pay_001', customerId = 'cust_001', invoiceId = 'inv_001'): SubTrackrPayment {
  return {
    id,
    invoiceId,
    customerId,
    amount: 49.99,
    currency: 'USD',
    paidAt: '2026-09-10T00:00:00Z',
  };
}

// ── OAuth Service Tests ───────────────────────────────────────────────────────

describe('QuickBooksOAuthService', () => {
  describe('getAuthorizationUrl', () => {
    it('returns a URL and a state nonce', () => {
      const service = new QuickBooksOAuthService(TEST_CREDENTIALS);
      const { url, state } = service.getAuthorizationUrl('merchant_001');

      expect(url).toContain('appcenter.intuit.com/connect/oauth2');
      expect(url).toContain('client_id=test_client_id');
      expect(url).toContain(`state=${state}`);
      expect(state).toHaveLength(32);
    });

    it('generates different states for concurrent requests', () => {
      const service = new QuickBooksOAuthService(TEST_CREDENTIALS);
      const { state: s1 } = service.getAuthorizationUrl('merchant_001');
      const { state: s2 } = service.getAuthorizationUrl('merchant_001');
      expect(s1).not.toBe(s2);
    });
  });

  describe('handleCallback', () => {
    it('exchanges code for tokens and stores them', async () => {
      const fetch = mockFetchWithJson(makeTokenResponse());
      const service = new QuickBooksOAuthService(TEST_CREDENTIALS, fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');
      const tokens = await service.handleCallback('auth_code_abc', state, 'realm_123');

      expect(tokens.accessToken).toBe('access_tok_001');
      expect(tokens.refreshToken).toBe('refresh_tok_001');
      expect(tokens.realmId).toBe('realm_123');
      expect(tokens.merchantId).toBe('merchant_001');
      expect(tokens.accessTokenExpiresAt).toBeGreaterThan(Date.now());
    });

    it('throws on invalid state parameter', async () => {
      const service = new QuickBooksOAuthService(TEST_CREDENTIALS);
      await expect(
        service.handleCallback('code', 'invalid-state', 'realm_123'),
      ).rejects.toThrow('Invalid or unknown OAuth state parameter');
    });

    it('throws on expired state', async () => {
      jest.useFakeTimers();
      const service = new QuickBooksOAuthService(TEST_CREDENTIALS);
      const { state } = service.getAuthorizationUrl('merchant_001');

      // Advance 11 minutes (state TTL is 10 min)
      jest.advanceTimersByTime(11 * 60 * 1000);

      await expect(
        service.handleCallback('code', state, 'realm_123'),
      ).rejects.toThrow('expired');

      jest.useRealTimers();
    });
  });

  describe('isConnected', () => {
    it('returns true for a merchant with valid tokens', async () => {
      const fetch = mockFetchWithJson(makeTokenResponse());
      const service = new QuickBooksOAuthService(TEST_CREDENTIALS, fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');
      await service.handleCallback('code', state, 'realm_123');

      expect(service.isConnected('merchant_001')).toBe(true);
    });

    it('returns false for an unknown merchant', () => {
      const service = new QuickBooksOAuthService(TEST_CREDENTIALS);
      expect(service.isConnected('nonexistent')).toBe(false);
    });
  });

  describe('getValidAccessToken', () => {
    it('returns the stored token when not expired', async () => {
      const fetch = mockFetchWithJson(makeTokenResponse());
      const service = new QuickBooksOAuthService(TEST_CREDENTIALS, fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');
      await service.handleCallback('code', state, 'realm_123');

      const token = await service.getValidAccessToken('merchant_001');
      expect(token).toBe('access_tok_001');
      // Only the callback exchange fetch, no refresh
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('refreshes the token when near expiry', async () => {
      jest.useFakeTimers();
      // Token expires in 2 seconds (well within 5-min buffer)
      const shortLivedResponse = makeTokenResponse({ expires_in: 2 });
      const refreshedResponse = makeTokenResponse({ access_token: 'refreshed_tok' });
      const fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve(shortLivedResponse),
          text: () => Promise.resolve(JSON.stringify(shortLivedResponse)),
        })
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve(refreshedResponse),
          text: () => Promise.resolve(JSON.stringify(refreshedResponse)),
        });

      const service = new QuickBooksOAuthService(TEST_CREDENTIALS, fetch);
      const { state } = service.getAuthorizationUrl('merchant_001');
      await service.handleCallback('code', state, 'realm_123');

      // Advance time so access token is within the refresh buffer
      jest.advanceTimersByTime(10 * 1000);

      const token = await service.getValidAccessToken('merchant_001');
      expect(token).toBe('refreshed_tok');
      expect(fetch).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('throws when merchant has no stored tokens', async () => {
      const service = new QuickBooksOAuthService(TEST_CREDENTIALS);
      await expect(service.getValidAccessToken('ghost_merchant')).rejects.toThrow(
        'No QuickBooks connection found',
      );
    });
  });

  describe('disconnect', () => {
    it('revokes token and removes stored tokens', async () => {
      const exchangeFetch = mockFetchWithJson(makeTokenResponse());
      const revokeFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      const fetch = jest.fn()
        .mockResolvedValueOnce(await exchangeFetch())
        .mockResolvedValueOnce(await revokeFetch());

      const service = new QuickBooksOAuthService(TEST_CREDENTIALS, fetch);
      const { state } = service.getAuthorizationUrl('merchant_001');
      await service.handleCallback('code', state, 'realm_123');

      await service.disconnect('merchant_001');
      expect(service.isConnected('merchant_001')).toBe(false);
    });
  });
});

// ── Sync Service Tests ────────────────────────────────────────────────────────

describe('QuickBooksSyncService', () => {
  function makeConnectedServices() {
    const createResponse = (id: string, entityKey: string) =>
      mockFetchWithJson({ [entityKey]: { Id: id, SyncToken: '0' } });

    const oauthService = new QuickBooksOAuthService(TEST_CREDENTIALS);
    oauthService.storeTokenSet({
      accessToken: 'live_access_token',
      refreshToken: 'live_refresh_token',
      accessTokenExpiresAt: Date.now() + 3600 * 1000,
      refreshTokenExpiresAt: Date.now() + 8726400 * 1000,
      realmId: 'realm_999',
      merchantId: 'merchant_001',
      obtainedAt: Date.now(),
    });

    return { oauthService, createResponse };
  }

  describe('syncCustomer', () => {
    it('creates a new customer and stores the mapping', async () => {
      const { oauthService, createResponse } = makeConnectedServices();
      const fetch = createResponse('qbo_cust_001', 'Customer');
      const syncService = new QuickBooksSyncService(oauthService, fetch);

      const mapping = await syncService.syncCustomer('merchant_001', makeCustomer());

      expect(mapping.subTrackrId).toBe('cust_001');
      expect(mapping.qboId).toBe('qbo_cust_001');
      expect(mapping.entityType).toBe('customer');
      expect(mapping.lastSyncedAt).toBeTruthy();
    });

    it('updates an existing customer on second call', async () => {
      const { oauthService } = makeConnectedServices();
      const fetch = mockFetchWithJson({ Customer: { Id: 'qbo_cust_001', SyncToken: '1' } });
      const syncService = new QuickBooksSyncService(oauthService, fetch);

      // Seed the mapping
      syncService.storeMapping({
        subTrackrId: 'cust_001',
        qboId: 'qbo_cust_001',
        qboSyncToken: '0',
        entityType: 'customer',
        lastSyncedAt: new Date().toISOString(),
      });

      const mapping = await syncService.syncCustomer('merchant_001', makeCustomer());
      expect(mapping.qboSyncToken).toBe('1');
    });
  });

  describe('syncPlan', () => {
    it('creates a QBO Item for a subscription plan', async () => {
      const { oauthService } = makeConnectedServices();
      const fetch = mockFetchWithJson({ Item: { Id: 'qbo_item_001', SyncToken: '0' } });
      const syncService = new QuickBooksSyncService(oauthService, fetch);

      const mapping = await syncService.syncPlan('merchant_001', makePlan());
      expect(mapping.qboId).toBe('qbo_item_001');
      expect(mapping.entityType).toBe('item');
    });
  });

  describe('syncInvoice', () => {
    it('creates an invoice after the customer exists in QBO', async () => {
      const { oauthService } = makeConnectedServices();
      const fetch = mockFetchWithJson({ Invoice: { Id: 'qbo_inv_001', SyncToken: '0' } });
      const syncService = new QuickBooksSyncService(oauthService, fetch);

      // Pre-seed customer mapping
      syncService.storeMapping({
        subTrackrId: 'cust_001',
        qboId: 'qbo_cust_001',
        qboSyncToken: '0',
        entityType: 'customer',
        lastSyncedAt: new Date().toISOString(),
      });

      const mapping = await syncService.syncInvoice('merchant_001', makeInvoice());
      expect(mapping.qboId).toBe('qbo_inv_001');
      expect(mapping.entityType).toBe('invoice');
    });

    it('throws when customer has not been synced first', async () => {
      const { oauthService } = makeConnectedServices();
      const fetch = mockFetchWithJson({});
      const syncService = new QuickBooksSyncService(oauthService, fetch);

      await expect(syncService.syncInvoice('merchant_001', makeInvoice())).rejects.toThrow(
        'has not been synced to QuickBooks',
      );
    });

    it('skips already-paid invoices on update', async () => {
      const { oauthService } = makeConnectedServices();
      const fetch = mockFetchWithJson({ Invoice: { Id: 'qbo_inv_001', SyncToken: '0' } });
      const syncService = new QuickBooksSyncService(oauthService, fetch);

      syncService.storeMapping({
        subTrackrId: 'cust_001',
        qboId: 'qbo_cust_001',
        qboSyncToken: '0',
        entityType: 'customer',
        lastSyncedAt: new Date().toISOString(),
      });
      // Pre-seed existing invoice mapping
      syncService.storeMapping({
        subTrackrId: 'inv_001',
        qboId: 'qbo_inv_001',
        qboSyncToken: '0',
        entityType: 'invoice',
        lastSyncedAt: new Date().toISOString(),
      });

      const paidInvoice: SubTrackrInvoice = { ...makeInvoice(), status: 'paid' };
      const mapping = await syncService.syncInvoice('merchant_001', paidInvoice);

      // fetch should NOT have been called (no update for paid invoices)
      expect(fetch).not.toHaveBeenCalled();
      expect(mapping.qboId).toBe('qbo_inv_001');
    });
  });

  describe('syncPayment', () => {
    it('creates a QBO Payment linked to an invoice', async () => {
      const { oauthService } = makeConnectedServices();
      const fetch = mockFetchWithJson({ Payment: { Id: 'qbo_pay_001', SyncToken: '0' } });
      const syncService = new QuickBooksSyncService(oauthService, fetch);

      syncService.storeMapping({
        subTrackrId: 'cust_001', qboId: 'qbo_cust_001', qboSyncToken: '0',
        entityType: 'customer', lastSyncedAt: new Date().toISOString(),
      });
      syncService.storeMapping({
        subTrackrId: 'inv_001', qboId: 'qbo_inv_001', qboSyncToken: '0',
        entityType: 'invoice', lastSyncedAt: new Date().toISOString(),
      });

      const mapping = await syncService.syncPayment('merchant_001', makePayment());
      expect(mapping.qboId).toBe('qbo_pay_001');
      expect(mapping.entityType).toBe('payment');
    });

    it('skips re-syncing a payment that was already recorded', async () => {
      const { oauthService } = makeConnectedServices();
      const fetch = mockFetchWithJson({ Payment: { Id: 'qbo_pay_001', SyncToken: '0' } });
      const syncService = new QuickBooksSyncService(oauthService, fetch);

      syncService.storeMapping({
        subTrackrId: 'cust_001', qboId: 'qbo_cust_001', qboSyncToken: '0',
        entityType: 'customer', lastSyncedAt: new Date().toISOString(),
      });
      syncService.storeMapping({
        subTrackrId: 'pay_001', qboId: 'qbo_pay_001', qboSyncToken: '0',
        entityType: 'payment', lastSyncedAt: new Date().toISOString(),
      });

      const mapping = await syncService.syncPayment('merchant_001', makePayment());
      expect(fetch).not.toHaveBeenCalled();
      expect(mapping.qboId).toBe('qbo_pay_001');
    });
  });

  describe('fullSync', () => {
    it('syncs all entities and returns a summary', async () => {
      const { oauthService } = makeConnectedServices();

      // Each entity type needs a different response shape
      const fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ Customer: { Id: 'qbo_c1', SyncToken: '0' } }), text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ Item: { Id: 'qbo_i1', SyncToken: '0' } }), text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ Invoice: { Id: 'qbo_inv1', SyncToken: '0' } }), text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ Payment: { Id: 'qbo_pay1', SyncToken: '0' } }), text: () => Promise.resolve('') });

      const syncService = new QuickBooksSyncService(oauthService, fetch);

      const result = await syncService.fullSync('merchant_001', {
        customers: [makeCustomer()],
        plans: [makePlan()],
        invoices: [makeInvoice()],
        payments: [makePayment()],
      });

      expect(result.customers.created).toBe(1);
      expect(result.items.created).toBe(1);
      expect(result.invoices.created).toBe(1);
      expect(result.payments.created).toBe(1);
      expect(result.syncedAt).toBeTruthy();
    });
  });
});
