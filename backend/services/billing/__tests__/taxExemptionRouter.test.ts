/**
 * Unit tests for taxExemptionRouter (issue #1740).
 *
 * Covers:
 *  - PUT  /tax-exemptions                     → set the per-customer flag
 *  - GET  /tax-exemptions/:customerId         → current status
 *  - GET  /tax-exemptions/:customerId/audit   → audit-trail entries
 *  - Validation errors → 400, store failure → 500, bad method → 405
 *  - Non-matching path → returns false
 */

import { describe, it, expect, jest } from '@jest/globals';
import type http from 'node:http';
import { createTaxExemptionRouter } from '../taxExemptionRouter';
import { TaxExemptionValidationError } from '../taxExemptionService';
import type { CustomerTaxStatus } from '../taxTypes';

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

function makeReq(
  method: string,
  url: string,
  rawBody?: string,
  headers: Record<string, string> = {}
): http.IncomingMessage {
  const chunks = rawBody !== undefined ? [Buffer.from(rawBody)] : [];
  const req = {
    method,
    url,
    headers: { host: 'localhost', ...headers },
    socket: { remoteAddress: '10.0.0.1' },
    on(event: string, handler: (chunk?: unknown) => void) {
      if (event === 'data') for (const c of chunks) handler(c);
      if (event === 'end') handler();
      return req;
    },
  } as unknown as http.IncomingMessage;
  return req;
}

const status: CustomerTaxStatus = {
  isExempt: true,
  certificateId: 'CERT-1',
  certificateExpiry: 0,
  issuingAuthority: 'IRS',
  exemptJurisdictions: [],
};

function makeService() {
  const get = jest.fn(async (_customerId: string) => status as CustomerTaxStatus | null);
  const set = jest.fn(async (customerId: string) => ({
    customerId,
    status,
    auditEntry: null,
  }));
  const isExempt = jest.fn(async () => true);
  const listAudit = jest.fn(() => [{ action: 'compliance.tax_exempt_change' }]);
  return { service: { get, set, isExempt, listAudit }, get, set, listAudit };
}

describe('taxExemptionRouter', () => {
  it('PUT /tax-exemptions sets the flag and passes reason/actor through', async () => {
    const { service, set } = makeService();
    const router = createTaxExemptionRouter(service);
    const res = makeRes();

    const handled = await router(
      makeReq(
        'PUT',
        '/tax-exemptions',
        JSON.stringify({
          customerId: 'cust-1',
          isExempt: true,
          reason: 'Cert on file',
          actorId: 'admin-1',
          exemptJurisdictions: ['DE'],
        }),
        { 'x-forwarded-for': '203.0.113.7, 10.0.0.9', 'user-agent': 'jest-agent' }
      ),
      res,
      '/tax-exemptions'
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(set).toHaveBeenCalledWith(
      'cust-1',
      expect.objectContaining({
        isExempt: true,
        reason: 'Cert on file',
        actorId: 'admin-1',
        exemptJurisdictions: ['DE'],
        ipAddress: '203.0.113.7',
        userAgent: 'jest-agent',
      })
    );
    expect((res.json() as { customerId: string }).customerId).toBe('cust-1');
  });

  it('PUT with a validation failure → 400', async () => {
    const { service, set } = makeService();
    set.mockRejectedValueOnce(new TaxExemptionValidationError('reason is required'));
    const router = createTaxExemptionRouter(service);
    const res = makeRes();

    await router(
      makeReq('PUT', '/tax-exemptions', JSON.stringify({ customerId: 'cust-1', isExempt: true })),
      res,
      '/tax-exemptions'
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'reason is required' });
  });

  it('PUT with invalid JSON → 400', async () => {
    const { service } = makeService();
    const router = createTaxExemptionRouter(service);
    const res = makeRes();

    await router(makeReq('PUT', '/tax-exemptions', '{not json'), res, '/tax-exemptions');

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/Invalid JSON/);
  });

  it('PUT with a store failure → 500', async () => {
    const { service, set } = makeService();
    set.mockRejectedValueOnce(new Error('db down'));
    const router = createTaxExemptionRouter(service);
    const res = makeRes();

    await router(
      makeReq('PUT', '/tax-exemptions', JSON.stringify({ customerId: 'c', isExempt: true, reason: 'x' })),
      res,
      '/tax-exemptions'
    );

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'db down' });
  });

  it('GET /tax-exemptions/:customerId → 200 with the status', async () => {
    const { service, get } = makeService();
    const router = createTaxExemptionRouter(service);
    const res = makeRes();

    await router(makeReq('GET', '/tax-exemptions/cust-1'), res, '/tax-exemptions/cust-1');

    expect(res.statusCode).toBe(200);
    expect(get).toHaveBeenCalledWith('cust-1');
    expect(res.json()).toEqual({ customerId: 'cust-1', status, isExempt: true });
  });

  it('GET for an unset customer reports not exempt', async () => {
    const { service, get } = makeService();
    get.mockResolvedValueOnce(null);
    const router = createTaxExemptionRouter(service);
    const res = makeRes();

    await router(makeReq('GET', '/tax-exemptions/unknown'), res, '/tax-exemptions/unknown');

    expect(res.json()).toEqual({ customerId: 'unknown', status: null, isExempt: false });
  });

  it('GET /tax-exemptions/:customerId/audit → 200 with entries', async () => {
    const { service, listAudit } = makeService();
    const router = createTaxExemptionRouter(service);
    const res = makeRes();

    await router(makeReq('GET', '/tax-exemptions/cust-1/audit'), res, '/tax-exemptions/cust-1/audit');

    expect(listAudit).toHaveBeenCalledWith('cust-1');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('rejects unsupported methods with 405', async () => {
    const { service } = makeService();
    const router = createTaxExemptionRouter(service);

    const resPost = makeRes();
    await router(makeReq('POST', '/tax-exemptions', '{}'), resPost, '/tax-exemptions');
    expect(resPost.statusCode).toBe(405);

    const resDelete = makeRes();
    await router(makeReq('DELETE', '/tax-exemptions/cust-1'), resDelete, '/tax-exemptions/cust-1');
    expect(resDelete.statusCode).toBe(405);
  });

  it('returns false for non-matching paths', async () => {
    const { service } = makeService();
    const router = createTaxExemptionRouter(service);
    const res = makeRes();

    expect(await router(makeReq('GET', '/invoices'), res, '/invoices')).toBe(false);
    expect(await router(makeReq('GET', '/tax-exemptions/a/b/c'), res, '/tax-exemptions/a/b/c')).toBe(false);
  });
});
