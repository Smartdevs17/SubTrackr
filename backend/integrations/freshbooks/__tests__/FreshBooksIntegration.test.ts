/**
 * Tests for the FreshBooks accounting integration (#1238).
 *
 * Covers the OAuth code flow (state validation, expiry, single-use nonces,
 * PKCE, no-refresh-token expiry semantics) and the sync service (id mapping,
 * dependency ordering, immutable paid invoices and recorded payments, HTTP and
 * transport error classification).
 */

import { FreshBooksOAuthService, type FreshBooksCredentials } from '../FreshBooksOAuthService';
import {
  FreshBooksSyncService,
  type SubTrackrClient,
  type SubTrackrEstimate,
  type SubTrackrExpense,
  type SubTrackrInvoice,
  type SubTrackrPayment,
} from '../FreshBooksSyncService';

// ── Helpers ────────────────────────────────────────────────────────────────────

const TEST_CREDENTIALS: FreshBooksCredentials = {
  clientId: 'fb_client_id',
  clientSecret: 'fb_client_secret',
  redirectUri: 'http://localhost:3000/api/v1/freshbooks/callback',
};

interface MockResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

function jsonResponse(payload: unknown, status = 200): MockResponse {
  const text = JSON.stringify(payload);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** FreshBooks wraps single-entity responses in `{ response: { result: … } }`. */
function resultResponse(result: unknown, status = 200): MockResponse {
  return jsonResponse({ response: { result } }, status);
}

function createFetch(responses: readonly MockResponse[]): {
  fetchImpl: jest.Mock;
  urls: string[];
  methods: string[];
  bodies: string[];
} {
  const urls: string[] = [];
  const methods: string[] = [];
  const bodies: string[] = [];
  let index = 0;

  const fetchImpl = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
    urls.push(url);
    methods.push(init?.method ?? 'GET');
    bodies.push(init?.body ?? '');
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  });

  return { fetchImpl, urls, methods, bodies };
}

function makeClient(id = 'client_001'): SubTrackrClient {
  return {
    id,
    email: `user+${id}@example.com`,
    displayName: 'Ada Lovelace',
    phone: '+15555550000',
    addressLine1: '123 Main St',
    city: 'San Francisco',
    state: 'CA',
    postalCode: '94105',
    country: 'US',
    currency: 'usd',
  };
}

function makeInvoice(id = 'inv_001', clientId = 'client_001'): SubTrackrInvoice {
  return {
    id,
    subscriptionId: 'sub_001',
    subscriptionName: 'Pro Plan',
    clientId,
    amount: 49.99,
    currency: 'USD',
    issuedAt: '2026-09-01T00:00:00Z',
    dueAt: '2026-09-15T00:00:00Z',
    status: 'open',
    clientEmail: 'user@example.com',
  };
}

function makePayment(id = 'pay_001', clientId = 'client_001'): SubTrackrPayment {
  return {
    id,
    invoiceId: 'inv_001',
    clientId,
    amount: 49.99,
    currency: 'USD',
    paidAt: '2026-09-10T00:00:00Z',
    paymentType: 'creditcard',
    reference: 'ch_123',
  };
}

function makeExpense(id = 'exp_001'): SubTrackrExpense {
  return {
    id,
    vendor: 'Acme Cloud',
    category: 'Hosting',
    amount: 120,
    currency: 'USD',
    incurredAt: '2026-09-05T00:00:00Z',
    notes: 'September hosting',
  };
}

function makeEstimate(id = 'est_001'): SubTrackrEstimate {
  return {
    id,
    clientId: 'client_001',
    lineItems: [{ description: 'Pro Plan (annual)', amount: 499 }],
    expiresAt: '2026-10-01T00:00:00Z',
    status: 'sent',
  };
}

function connectedOAuthService(): FreshBooksOAuthService {
  const service = new FreshBooksOAuthService(TEST_CREDENTIALS);
  service.storeTokenSet({
    accessToken: 'live_access_token',
    accessTokenExpiresAt: Date.now() + 30 * 60 * 1000,
    accountId: 'acct_999',
    merchantId: 'merchant_001',
    obtainedAt: Date.now(),
  });
  return service;
}

// ── OAuth service ─────────────────────────────────────────────────────────────

describe('FreshBooksOAuthService', () => {
  describe('getAuthorizationUrl', () => {
    it('returns a FreshBooks URL carrying the client id, state and PKCE challenge', () => {
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS);
      const { url, state } = service.getAuthorizationUrl('merchant_001');

      expect(url).toContain('https://www.freshbooks.com/oauth/authorize');
      expect(url).toContain('client_id=fb_client_id');
      expect(url).toContain(`state=${state}`);
      expect(url).toContain('code_challenge_method=S256');
      expect(state).toHaveLength(32);
    });

    it('issues a distinct state and challenge for every request', () => {
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS);
      const first = service.getAuthorizationUrl('merchant_001');
      const second = service.getAuthorizationUrl('merchant_001');

      expect(first.state).not.toBe(second.state);
      expect(first.url).not.toBe(second.url);
    });

    it('honours a configured dialog mode', () => {
      const service = new FreshBooksOAuthService({
        ...TEST_CREDENTIALS,
        dialogMode: 'select_account',
      });
      const { url } = service.getAuthorizationUrl('merchant_001');

      expect(url).toContain('dialog=select_account');
    });
  });

  describe('handleCallback', () => {
    it('exchanges the code for a token and stores it against the merchant', async () => {
      const { fetchImpl } = createFetch([
        jsonResponse({ access_token: 'fb_access_1', expires_in: 1800, token_type: 'bearer' }),
      ]);
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS, fetchImpl as unknown as typeof fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');
      const tokens = await service.handleCallback('auth_code_abc', state, 'acct_123');

      expect(tokens.accessToken).toBe('fb_access_1');
      expect(tokens.accountId).toBe('acct_123');
      expect(tokens.merchantId).toBe('merchant_001');
      expect(tokens.accessTokenExpiresAt).toBeGreaterThan(Date.now());
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('sends the PKCE verifier recorded when the state was issued', async () => {
      const { fetchImpl, bodies } = createFetch([
        jsonResponse({ access_token: 'fb_access_1', expires_in: 1800 }),
      ]);
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS, fetchImpl as unknown as typeof fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');
      await service.handleCallback('auth_code_abc', state, 'acct_123');

      const body = new URLSearchParams(bodies[0]);
      expect(body.get('code_verifier')).toBeTruthy();
      expect(body.get('grant_type')).toBe('authorization_code');
    });

    it('rejects an unknown state parameter', async () => {
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS);

      await expect(service.handleCallback('code', 'not-a-state', 'acct_123')).rejects.toThrow(
        'Invalid or unknown OAuth state parameter',
      );
    });

    it('rejects an expired state', async () => {
      jest.useFakeTimers();
      try {
        const service = new FreshBooksOAuthService(TEST_CREDENTIALS);
        const { state } = service.getAuthorizationUrl('merchant_001');

        jest.advanceTimersByTime(11 * 60 * 1000);

        await expect(service.handleCallback('code', state, 'acct_123')).rejects.toThrow('expired');
      } finally {
        jest.useRealTimers();
      }
    });

    it('rejects a replayed state so a code cannot be exchanged twice', async () => {
      const { fetchImpl } = createFetch([
        jsonResponse({ access_token: 'fb_access_1', expires_in: 1800 }),
      ]);
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS, fetchImpl as unknown as typeof fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');
      await service.handleCallback('auth_code_abc', state, 'acct_123');

      await expect(service.handleCallback('auth_code_abc', state, 'acct_123')).rejects.toThrow(
        'Invalid or unknown OAuth state parameter',
      );
    });

    it('rejects a callback without an account id', async () => {
      const { fetchImpl } = createFetch([jsonResponse({ access_token: 'x', expires_in: 1800 })]);
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS, fetchImpl as unknown as typeof fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');

      await expect(service.handleCallback('code', state, '')).rejects.toThrow(
        'Missing FreshBooks account id',
      );
    });

    it('surfaces a failed token exchange', async () => {
      const { fetchImpl } = createFetch([jsonResponse({ error: 'invalid_grant' }, 400)]);
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS, fetchImpl as unknown as typeof fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');

      await expect(service.handleCallback('bad_code', state, 'acct_123')).rejects.toThrow(
        'FreshBooks token exchange failed: 400',
      );
    });

    it('rejects a token response with no access token', async () => {
      const { fetchImpl } = createFetch([jsonResponse({ expires_in: 1800 })]);
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS, fetchImpl as unknown as typeof fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');

      await expect(service.handleCallback('code', state, 'acct_123')).rejects.toThrow(
        'no access token',
      );
    });
  });

  describe('connection state', () => {
    it('reports connected while the access token is valid', async () => {
      const { fetchImpl } = createFetch([
        jsonResponse({ access_token: 'fb_access_1', expires_in: 1800 }),
      ]);
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS, fetchImpl as unknown as typeof fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');
      await service.handleCallback('code', state, 'acct_123');

      expect(service.isConnected('merchant_001')).toBe(true);
      expect(service.needsReconnect('merchant_001')).toBe(false);
      expect(service.getExpiresInMs('merchant_001')).toBeGreaterThan(0);
    });

    it('requires a reconnect once the access token has lapsed (no refresh token)', () => {
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS);
      service.storeTokenSet({
        accessToken: 'stale',
        accessTokenExpiresAt: Date.now() - 1000,
        accountId: 'acct_1',
        merchantId: 'merchant_001',
        obtainedAt: Date.now() - 60 * 60 * 1000,
      });

      expect(service.isConnected('merchant_001')).toBe(false);
      expect(service.needsReconnect('merchant_001')).toBe(true);
      expect(service.getExpiresInMs('merchant_001')).toBe(0);
    });

    it('returns the stored token without a network call', async () => {
      const { fetchImpl } = createFetch([]);
      const oauthService = new FreshBooksOAuthService(
        TEST_CREDENTIALS,
        fetchImpl as unknown as typeof fetch,
      );
      oauthService.storeTokenSet({
        accessToken: 'still_valid',
        accessTokenExpiresAt: Date.now() + 20 * 60 * 1000,
        accountId: 'acct_1',
        merchantId: 'merchant_001',
        obtainedAt: Date.now(),
      });

      await expect(oauthService.getValidAccessToken('merchant_001')).resolves.toBe('still_valid');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('reports zero remaining lifetime for an unknown merchant', () => {
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS);

      expect(service.isConnected('ghost')).toBe(false);
      expect(service.needsReconnect('ghost')).toBe(true);
      expect(service.getExpiresInMs('ghost')).toBe(0);
    });

    it('fails with a connect error when the merchant has no stored token', async () => {
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS);

      await expect(service.getValidAccessToken('ghost')).rejects.toThrow(
        'No FreshBooks connection found',
      );
    });

    it('fails with a reconnect error when the token has expired', async () => {
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS);
      service.storeTokenSet({
        accessToken: 'stale',
        accessTokenExpiresAt: Date.now() - 1000,
        accountId: 'acct_1',
        merchantId: 'merchant_001',
        obtainedAt: Date.now(),
      });

      await expect(service.getValidAccessToken('merchant_001')).rejects.toThrow('has expired');
    });
  });

  describe('disconnect', () => {
    it('drops the stored connection', async () => {
      const { fetchImpl } = createFetch([
        jsonResponse({ access_token: 'fb_access_1', expires_in: 1800 }),
      ]);
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS, fetchImpl as unknown as typeof fetch);

      const { state } = service.getAuthorizationUrl('merchant_001');
      await service.handleCallback('code', state, 'acct_123');

      service.disconnect('merchant_001');

      expect(service.isConnected('merchant_001')).toBe(false);
      expect(service.getTokenSet('merchant_001')).toBeUndefined();
    });

    it('is a no-op for an unknown merchant', () => {
      const service = new FreshBooksOAuthService(TEST_CREDENTIALS);
      expect(() => service.disconnect('ghost')).not.toThrow();
    });
  });
});

// ── Sync service ──────────────────────────────────────────────────────────────

describe('FreshBooksSyncService', () => {
  function makeService(responses: readonly MockResponse[]): {
    service: FreshBooksSyncService;
    urls: string[];
    methods: string[];
    bodies: string[];
    fetchMock: jest.Mock;
  } {
    const { fetchImpl, urls, methods, bodies } = createFetch(responses);
    const service = new FreshBooksSyncService({
      oauthService: connectedOAuthService(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    return { service, urls, methods, bodies, fetchMock: fetchImpl };
  }

  describe('clients', () => {
    it('creates a client and stores the FreshBooks id mapping', async () => {
      const { service, urls, methods } = makeService([
        resultResponse({ clientid: '99887', updated: '2026-09-01T00:00:00Z' }),
      ]);

      const mapping = await service.syncClient('merchant_001', makeClient());

      expect(methods[0]).toBe('POST');
      expect(urls[0]).toContain('/accounting/acct_999/api/clients');
      expect(mapping.freshBooksId).toBe('99887');
      expect(mapping.entityType).toBe('client');
      expect(mapping.freshBooksUpdatedAt).toBe('2026-09-01T00:00:00Z');
      expect(service.getMapping('client', 'client_001')?.freshBooksId).toBe('99887');
    });

    it('updates an existing client with PUT against the mapped id', async () => {
      const { service, urls, methods } = makeService([
        resultResponse({ clientid: '99887', updated: '2026-09-05T00:00:00Z' }),
      ]);

      await service.syncClient('merchant_001', makeClient());
      await service.syncClient('merchant_001', makeClient());

      expect(methods[1]).toBe('PUT');
      expect(urls[1]).toContain('/clients/clientid/99887');
    });

    it('splits the display name into first and last name', async () => {
      const { service, bodies } = makeService([resultResponse({ clientid: '1' })]);

      await service.syncClient('merchant_001', makeClient());

      const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
      expect(sent.first_name).toBe('Ada');
      expect(sent.last_name).toBe('Lovelace');
      expect(sent.email).toBe('user+client_001@example.com');
    });

    it('counts created, updated and skipped records across a batch', async () => {
      const { service } = makeService([resultResponse({ clientid: '99887' })]);

      await service.syncClient('merchant_001', makeClient('client_001'));
      await service.syncClient('merchant_001', makeClient('client_002'));

      const result = await service.syncClients('merchant_001', [
        makeClient('client_001'),
        makeClient('client_002'),
      ]);

      expect(result.entity).toBe('client');
      expect(result.updated).toBe(2);
      expect(result.created).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('records a terminal HTTP error without aborting the rest of the batch', async () => {
      const { fetchImpl } = createFetch([
        jsonResponse({ error: 'bad' }, 400),
        resultResponse({ clientid: '99888' }),
      ]);
      const service = new FreshBooksSyncService({
        oauthService: connectedOAuthService(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const result = await service.syncClients('merchant_001', [
        makeClient('client_001'),
        makeClient('client_002'),
      ]);

      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].id).toBe('client_001');
      expect(result.errors[0].retryable).toBe(false);
    });

    it('marks a 429 as retryable', async () => {
      const { service } = makeService([jsonResponse({ error: 'slow down' }, 429)]);

      const result = await service.syncClients('merchant_001', [makeClient()]);

      expect(result.errors[0].retryable).toBe(true);
      expect(result.errors[0].error).toContain('freshbooks_http_429');
    });

    it('marks a 503 as retryable', async () => {
      const { service } = makeService([jsonResponse({ error: 'unavailable' }, 503)]);

      const result = await service.syncClients('merchant_001', [makeClient()]);

      expect(result.errors[0].retryable).toBe(true);
    });

    it('marks a transport failure as retryable', async () => {
      const { fetchImpl } = createFetch([]);
      fetchImpl.mockRejectedValueOnce(new Error('socket hang up'));
      const service = new FreshBooksSyncService({
        oauthService: connectedOAuthService(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const result = await service.syncClients('merchant_001', [makeClient()]);

      expect(result.errors[0].retryable).toBe(true);
      expect(result.errors[0].error).toContain('freshbooks_transport_error');
    });

    it('refuses to call FreshBooks when the merchant has no connection', async () => {
      const { fetchImpl } = createFetch([resultResponse({ clientid: '1' })]);
      const service = new FreshBooksSyncService({
        oauthService: new FreshBooksOAuthService(TEST_CREDENTIALS),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const result = await service.syncClients('merchant_001', [makeClient()]);

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(result.errors[0].error).toContain('freshbooks_unauthorized');
    });
  });

  describe('invoices', () => {
    async function seedClient(
      service: FreshBooksSyncService,
      id = 'client_001',
    ): Promise<void> {
      service.storeMapping({
        subTrackrId: id,
        freshBooksId: '99887',
        entityType: 'client',
        lastSyncedAt: new Date().toISOString(),
      });
    }

    it('creates an invoice once the client is mapped', async () => {
      const { service, bodies, urls } = makeService([
        resultResponse({ invoiceid: '5501', updated: '2026-09-01T00:00:00Z' }),
      ]);
      await seedClient(service);

      const mapping = await service.syncInvoice('merchant_001', makeInvoice());

      expect(urls[0]).toContain('/accounting/acct_999/api/invoices');
      expect(mapping.freshBooksId).toBe('5501');
      expect(mapping.entityType).toBe('invoice');

      const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
      expect(sent.clientid).toBe('99887');
      expect(sent.date).toBe('2026-09-01');
      expect(sent.due_date).toBe('2026-09-15');
      expect(sent.status).toBe('sent');
    });

    it('fails when the client has not been synced first', async () => {
      const { service, fetchMock } = makeService([resultResponse({ invoiceid: '1' })]);

      await expect(service.syncInvoice('merchant_001', makeInvoice())).rejects.toThrow(
        'has not been synced to FreshBooks yet',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips a paid invoice that is already mapped so the ledger is not rewritten', async () => {
      const { service, fetchMock } = makeService([resultResponse({ invoiceid: '5501' })]);
      await seedClient(service);
      service.storeMapping({
        subTrackrId: 'inv_001',
        freshBooksId: '5501',
        entityType: 'invoice',
        lastSyncedAt: new Date().toISOString(),
      });

      const paid: SubTrackrInvoice = { ...makeInvoice(), status: 'paid' };
      const result = await service.syncInvoices('merchant_001', [paid]);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(0);
    });

    it('treats a voided invoice as a FreshBooks delete status', async () => {
      const { service, bodies } = makeService([resultResponse({ invoiceid: '5501' })]);
      await seedClient(service);

      await service.syncInvoice('merchant_001', { ...makeInvoice(), status: 'void' });

      const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
      expect(sent.status).toBe('deleted');
    });

    it('forwards FreshBooks tax names onto the invoice line', async () => {
      const { service, bodies } = makeService([resultResponse({ invoiceid: '5501' })]);
      await seedClient(service);

      await service.syncInvoice('merchant_001', { ...makeInvoice(), taxNames: ['VAT'] });

      const sent = JSON.parse(bodies[0]) as { lines: Array<{ tax_names?: string[] }> };
      expect(sent.lines[0].tax_names).toEqual(['VAT']);
    });

    it('treats an empty 200 body as a successful create', async () => {
      const { fetchImpl } = createFetch([{ ok: true, status: 200, text: async () => '' }]);
      const service = new FreshBooksSyncService({
        oauthService: connectedOAuthService(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      service.storeMapping({
        subTrackrId: 'client_001',
        freshBooksId: '99887',
        entityType: 'client',
        lastSyncedAt: new Date().toISOString(),
      });

      await expect(service.syncInvoice('merchant_001', makeInvoice())).rejects.toThrow(
        'contained no id',
      );
    });
  });

  describe('payments', () => {
    function seedPrerequisites(service: FreshBooksSyncService): void {
      service.storeMapping({
        subTrackrId: 'client_001',
        freshBooksId: '99887',
        entityType: 'client',
        lastSyncedAt: new Date().toISOString(),
      });
      service.storeMapping({
        subTrackrId: 'inv_001',
        freshBooksId: '5501',
        entityType: 'invoice',
        lastSyncedAt: new Date().toISOString(),
      });
    }

    it('records a payment against the mapped invoice', async () => {
      const { service, bodies, urls } = makeService([
        resultResponse({ paymentid: '7700' }),
      ]);
      seedPrerequisites(service);

      const mapping = await service.syncPayment('merchant_001', makePayment());

      expect(urls[0]).toContain('/accounting/acct_999/api/payments');
      expect(mapping.freshBooksId).toBe('7700');

      const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
      expect(sent.clientid).toBe('99887');
      expect(sent.date).toBe('2026-09-10');
      expect(sent.payment_type).toBe('creditcard');
      expect(sent.invoice_payment).toEqual({ invoiceid: '5501' });
    });

    it('never re-posts a payment that was already recorded', async () => {
      const { service, fetchMock } = makeService([resultResponse({ paymentid: '7700' })]);
      seedPrerequisites(service);

      await service.syncPayment('merchant_001', makePayment());
      const result = await service.syncPayments('merchant_001', [makePayment()]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.skipped).toBe(1);
    });

    it('fails when the referenced invoice has not been synced', async () => {
      const { service } = makeService([resultResponse({ paymentid: '7700' })]);
      service.storeMapping({
        subTrackrId: 'client_001',
        freshBooksId: '99887',
        entityType: 'client',
        lastSyncedAt: new Date().toISOString(),
      });

      await expect(service.syncPayment('merchant_001', makePayment())).rejects.toThrow(
        'Invoice inv_001 has not been synced',
      );
    });
  });

  describe('expenses', () => {
    it('creates an expense with an amount envelope', async () => {
      const { service, bodies, urls } = makeService([resultResponse({ expenseid: '4242' })]);

      const mapping = await service.syncExpense('merchant_001', makeExpense());

      expect(urls[0]).toContain('/accounting/acct_999/api/expenses/expenses');
      expect(mapping.freshBooksId).toBe('4242');

      const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
      expect(sent.amount).toEqual({ amount: 120, currency_code: 'USD' });
      expect(sent.category).toBe('Hosting');
      expect(sent.billable).toBe(false);
    });

    it('marks an expense tied to a client as billable', async () => {
      const { service, bodies } = makeService([resultResponse({ expenseid: '4243' })]);
      service.storeMapping({
        subTrackrId: 'client_001',
        freshBooksId: '99887',
        entityType: 'client',
        lastSyncedAt: new Date().toISOString(),
      });

      await service.syncExpense('merchant_001', { ...makeExpense(), clientId: 'client_001' });

      const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
      expect(sent.billable).toBe(true);
      expect(sent.clientid).toBe('99887');
    });

    it('rejects an expense that references an unmapped client', async () => {
      const { service } = makeService([resultResponse({ expenseid: '4244' })]);

      await expect(
        service.syncExpense('merchant_001', { ...makeExpense(), clientId: 'client_unknown' }),
      ).rejects.toThrow('has not been synced to FreshBooks yet');
    });

    it('falls back to the configured default category when blank', async () => {
      const { fetchImpl, bodies } = createFetch([resultResponse({ expenseid: '4245' })]);
      const custom = new FreshBooksSyncService({
        oauthService: connectedOAuthService(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
        defaultExpenseCategory: 'Software',
      });

      await custom.syncExpense('merchant_001', { ...makeExpense(), category: '' });

      expect((JSON.parse(bodies[0]) as Record<string, unknown>).category).toBe('Software');
    });
  });

  describe('estimates', () => {
    it('creates an estimate for a mapped client', async () => {
      const { service, bodies, urls } = makeService([resultResponse({ estimateid: '3131' })]);
      service.storeMapping({
        subTrackrId: 'client_001',
        freshBooksId: '99887',
        entityType: 'client',
        lastSyncedAt: new Date().toISOString(),
      });

      const mapping = await service.syncEstimate('merchant_001', makeEstimate());

      expect(urls[0]).toContain('/accounting/acct_999/api/estimates/estimates');
      expect(mapping.entityType).toBe('estimate');

      const sent = JSON.parse(bodies[0]) as Record<string, unknown>;
      expect(sent.clientid).toBe('99887');
      expect(sent.expiry_date).toBe('2026-10-01');
      expect(sent.status).toBe('sent');
    });

    it('skips an accepted estimate that is already mapped', async () => {
      const { service, fetchMock } = makeService([resultResponse({ estimateid: '3131' })]);
      service.storeMapping({
        subTrackrId: 'client_001',
        freshBooksId: '99887',
        entityType: 'client',
        lastSyncedAt: new Date().toISOString(),
      });
      service.storeMapping({
        subTrackrId: 'est_001',
        freshBooksId: '3131',
        entityType: 'estimate',
        lastSyncedAt: new Date().toISOString(),
      });

      const result = await service.syncEstimates('merchant_001', [
        { ...makeEstimate(), status: 'accepted' },
      ]);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
    });
  });

  describe('fullSync', () => {
    it('syncs every entity type and returns a per-entity summary', async () => {
      const { fetchImpl } = createFetch([
        resultResponse({ clientid: '99887' }),
        resultResponse({ invoiceid: '5501' }),
        resultResponse({ paymentid: '7700' }),
        resultResponse({ expenseid: '4242' }),
        resultResponse({ estimateid: '3131' }),
      ]);
      const service = new FreshBooksSyncService({
        oauthService: connectedOAuthService(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const result = await service.fullSync('merchant_001', {
        clients: [makeClient()],
        invoices: [makeInvoice()],
        payments: [makePayment()],
        expenses: [makeExpense()],
        estimates: [makeEstimate()],
      });

      expect(result.clients.created).toBe(1);
      expect(result.invoices.created).toBe(1);
      expect(result.payments.created).toBe(1);
      expect(result.expenses.created).toBe(1);
      expect(result.syncedAt).toBeTruthy();
      expect(fetchImpl).toHaveBeenCalledTimes(5);
    });

    it('tolerates the optional collections being omitted', async () => {
      const { fetchImpl } = createFetch([resultResponse({ clientid: '99887' })]);
      const service = new FreshBooksSyncService({
        oauthService: connectedOAuthService(),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const result = await service.fullSync('merchant_001', {
        clients: [makeClient()],
        invoices: [],
        payments: [],
      });

      expect(result.expenses.created).toBe(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  describe('mappings', () => {
    it('keys mappings by entity type so ids cannot collide', () => {
      const { service } = makeService([]);
      const timestamp = new Date().toISOString();

      service.storeMapping({
        subTrackrId: 'shared_id',
        freshBooksId: '1',
        entityType: 'client',
        lastSyncedAt: timestamp,
      });
      service.storeMapping({
        subTrackrId: 'shared_id',
        freshBooksId: '2',
        entityType: 'invoice',
        lastSyncedAt: timestamp,
      });

      expect(service.getMapping('client', 'shared_id')?.freshBooksId).toBe('1');
      expect(service.getMapping('invoice', 'shared_id')?.freshBooksId).toBe('2');
    });

    it('returns undefined for an unknown mapping', () => {
      const { service } = makeService([]);
      expect(service.getMapping('invoice', 'nope')).toBeUndefined();
    });
  });
});
