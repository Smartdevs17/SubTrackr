/**
 * Unit tests for invoiceNumberingRouter (issue #1738).
 *
 * Covers:
 *  - GET  /invoice-numbering?merchantId=…  → current scheme (or defaults)
 *  - PUT  /invoice-numbering               → configure a merchant's scheme
 *  - Validation: missing merchantId / invalid scheme → 400
 *  - Store failure → 500, non-GET/PUT → 405
 *  - Non-matching path → returns false
 */

import { describe, it, expect, jest } from '@jest/globals';
import type http from 'node:http';
import { createInvoiceNumberingRouter } from '../router/invoiceNumberingRouter';
import {
  DEFAULT_INVOICE_NUMBERING_SCHEME,
  InvoiceNumberingValidationError,
  type InvoiceNumberingView,
} from '../domain/InvoiceNumberingService';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type MockRes = http.ServerResponse & {
  statusCode: number;
  body: string;
  json(): unknown;
};

function makeRes(): MockRes {
  let statusCode = 0;
  let body = '';
  return {
    writeHead(code: number) {
      statusCode = code;
    },
    end(data?: unknown) {
      body = data ? String(data) : '';
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    json() {
      return JSON.parse(body);
    },
  } as unknown as MockRes;
}

function makeReq(method: string, url: string, rawBody?: string): http.IncomingMessage {
  const chunks = rawBody !== undefined ? [Buffer.from(rawBody)] : [];
  const req = {
    method,
    url,
    headers: { host: 'localhost' },
    on(event: string, handler: (chunk?: unknown) => void) {
      if (event === 'data') for (const c of chunks) handler(c);
      if (event === 'end') handler();
      return req;
    },
  } as unknown as http.IncomingMessage;
  return req;
}

function makeView(merchantId: string, overrides: Partial<InvoiceNumberingView> = {}): InvoiceNumberingView {
  return {
    merchantId,
    scheme: { ...DEFAULT_INVOICE_NUMBERING_SCHEME },
    isDefault: true,
    sequence: 0,
    period: '2026',
    nextExample: 'INV-2026-000001',
    ...overrides,
  };
}

function makeService() {
  const getScheme = jest.fn(async (merchantId: string) => makeView(merchantId));
  const configureScheme = jest.fn(async (merchantId: string) =>
    makeView(merchantId, { isDefault: false })
  );
  const nextNumber = jest.fn(async () => ({
    invoiceNumber: 'INV-2026-000001',
    sequence: 1,
    period: '2026',
    scheme: { ...DEFAULT_INVOICE_NUMBERING_SCHEME },
  }));
  return {
    service: { getScheme, configureScheme, nextNumber },
    getScheme,
    configureScheme,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('invoiceNumberingRouter', () => {
  it('GET without merchantId → 400', async () => {
    const { service } = makeService();
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    expect(await router(makeReq('GET', '/invoice-numbering'), res, '/invoice-numbering')).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'merchantId query parameter is required' });
  });

  it('GET with merchantId → 200 and the merchant view', async () => {
    const { service, getScheme } = makeService();
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    await router(
      makeReq('GET', '/invoice-numbering?merchantId=merch_a'),
      res,
      '/invoice-numbering'
    );

    expect(res.statusCode).toBe(200);
    expect(getScheme).toHaveBeenCalledWith('merch_a');
    expect((res.json() as InvoiceNumberingView).merchantId).toBe('merch_a');
  });

  it('GET with an unrelated query string still works', async () => {
    const { service, getScheme } = makeService();
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    await router(
      makeReq('GET', '/invoice-numbering?foo=bar&merchantId=merch_b'),
      res,
      '/invoice-numbering'
    );

    expect(res.statusCode).toBe(200);
    expect(getScheme).toHaveBeenCalledWith('merch_b');
  });

  it('PUT with a flat body → 200 and passes the body as the patch', async () => {
    const { service, configureScheme } = makeService();
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();
    const body = JSON.stringify({ merchantId: 'merch_a', prefix: 'ACME', padding: 4 });

    await router(makeReq('PUT', '/invoice-numbering', body), res, '/invoice-numbering');

    expect(res.statusCode).toBe(200);
    expect(configureScheme).toHaveBeenCalledWith('merch_a', {
      merchantId: 'merch_a',
      prefix: 'ACME',
      padding: 4,
    });
  });

  it('PUT with a nested scheme → passes only the scheme object', async () => {
    const { service, configureScheme } = makeService();
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();
    const body = JSON.stringify({ merchantId: 'merch_a', scheme: { prefix: 'ACME' } });

    await router(makeReq('PUT', '/invoice-numbering', body), res, '/invoice-numbering');

    expect(res.statusCode).toBe(200);
    expect(configureScheme).toHaveBeenCalledWith('merch_a', { prefix: 'ACME' });
  });

  it('PUT without merchantId → 400 from the service validation', async () => {
    const { service, configureScheme } = makeService();
    configureScheme.mockImplementation(async (merchantId: string) => {
      if (!merchantId) throw new InvoiceNumberingValidationError('merchantId is required');
      return makeView(merchantId);
    });
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    await router(
      makeReq('PUT', '/invoice-numbering', JSON.stringify({ prefix: 'ACME' })),
      res,
      '/invoice-numbering'
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'merchantId is required' });
  });

  it('PUT with an invalid scheme → 400', async () => {
    const { service, configureScheme } = makeService();
    configureScheme.mockImplementation(async () => {
      throw new InvoiceNumberingValidationError('padding must be an integer between 1 and 12');
    });
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    await router(
      makeReq('PUT', '/invoice-numbering', JSON.stringify({ merchantId: 'merch_a', padding: 0 })),
      res,
      '/invoice-numbering'
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'padding must be an integer between 1 and 12' });
  });

  it('PUT with an explicit null scheme → 400', async () => {
    const { service, configureScheme } = makeService();
    configureScheme.mockImplementation(async () => {
      throw new InvoiceNumberingValidationError('scheme must be an object');
    });
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    await router(
      makeReq('PUT', '/invoice-numbering', JSON.stringify({ merchantId: 'merch_a', scheme: null })),
      res,
      '/invoice-numbering'
    );

    expect(res.statusCode).toBe(400);
    expect(configureScheme).toHaveBeenCalledWith('merch_a', null);
  });

  it('PUT with a malformed JSON body → 400', async () => {
    const { service } = makeService();
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    await router(makeReq('PUT', '/invoice-numbering', '{not json'), res, '/invoice-numbering');

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it('store failure → 500', async () => {
    const { service, configureScheme } = makeService();
    configureScheme.mockImplementation(async () => {
      throw new Error('connection lost');
    });
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    await router(
      makeReq('PUT', '/invoice-numbering', JSON.stringify({ merchantId: 'merch_a' })),
      res,
      '/invoice-numbering'
    );

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'connection lost' });
  });

  it('GET store failure → 500', async () => {
    const { service, getScheme } = makeService();
    getScheme.mockImplementation(async () => {
      throw new Error('connection lost');
    });
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    await router(
      makeReq('GET', '/invoice-numbering?merchantId=merch_a'),
      res,
      '/invoice-numbering'
    );

    expect(res.statusCode).toBe(500);
  });

  it('unsupported method → 405', async () => {
    const { service } = makeService();
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    expect(await router(makeReq('POST', '/invoice-numbering'), res, '/invoice-numbering')).toBe(true);
    expect(res.statusCode).toBe(405);
  });

  it('ignores subpaths so other handlers can claim them', async () => {
    const { service } = makeService();
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    expect(await router(makeReq('GET', '/invoice-numbering/next'), res, '/invoice-numbering/next')).toBe(
      false
    );
    expect(res.body).toBe('');
  });

  it('ignores unrelated paths', async () => {
    const { service } = makeService();
    const router = createInvoiceNumberingRouter(service);
    const res = makeRes();

    expect(await router(makeReq('GET', '/invoices'), res, '/invoices')).toBe(false);
    expect(await router(makeReq('GET', '/invoice-numbering-other'), res, '/invoice-numbering-other')).toBe(
      false
    );
    expect(res.body).toBe('');
  });
});
