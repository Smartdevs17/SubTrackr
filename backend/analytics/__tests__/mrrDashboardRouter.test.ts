/**
 * Unit tests for mrrDashboardRouter.ts
 *
 * Covers:
 *  - POST /analytics/mrr/subscriptions  → store subscription list
 *  - GET  /analytics/mrr                → full dashboard snapshot
 *  - GET  /analytics/mrr/breakdown      → MRR movement components
 *  - GET  /analytics/mrr/arr            → ARR summary
 *  - GET  /analytics/mrr/trend          → revenue trend points
 *  - GET  /analytics/mrr/export         → CSV and JSON download
 *  - Validation: missing merchantId → 400
 *  - Non-GET to read endpoint → 405
 *  - Non-matching path → returns false
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import type http from 'node:http';
import { mrrDashboardRouter } from '../mrrDashboardRouter';
import { BillingCycle, SubscriptionCategory } from '../../../src/types/subscription';
import type { Subscription } from '../../../src/types/subscription';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type MockRes = http.ServerResponse & {
  statusCode: number; body: string;
  headers: Record<string, string>;
  json(): unknown;
};

function makeRes(): MockRes {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let body = '';
  return {
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      Object.assign(headers, hdrs ?? {});
    },
    end(data?: unknown) { body = data ? String(data) : ''; },
    get statusCode() { return statusCode; },
    get body() { return body; },
    get headers() { return headers; },
    json() { return JSON.parse(body); },
  } as unknown as MockRes;
}

function makeReq(method: string, url: string, bodyObj?: unknown): http.IncomingMessage {
  const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
  const chunks = bodyStr ? [Buffer.from(bodyStr)] : [];
  const req = {
    method, url,
    headers: { host: 'localhost' },
    on(event: string, handler: (chunk?: unknown) => void) {
      if (event === 'data') for (const c of chunks) handler(c);
      if (event === 'end') handler();
      return req;
    },
  } as unknown as http.IncomingMessage;
  return req;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MERCHANT = 'merch_1754';

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: `sub_${Math.random().toString(36).slice(2)}`,
    name: 'Basic Plan',
    category: SubscriptionCategory.SOFTWARE,
    price: 29,
    currency: 'USD',
    billingCycle: BillingCycle.MONTHLY,
    nextBillingDate: new Date(),
    isActive: true,
    isCryptoEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const CURR_SUBS = [makeSub({ price: 29 }), makeSub({ price: 49 }), makeSub({ price: 99 })];
const PREV_SUBS = [makeSub({ price: 29 }), makeSub({ price: 49 })];

// Seed the router's in-memory store before all tests.
beforeAll(async () => {
  const res = makeRes();
  await mrrDashboardRouter(
    makeReq('POST', '/analytics/mrr/subscriptions', {
      merchantId: MERCHANT,
      subscriptions: CURR_SUBS,
      prevSubscriptions: PREV_SUBS,
    }),
    res,
    '/analytics/mrr/subscriptions'
  );
});

// ─── Non-matching path ────────────────────────────────────────────────────────

describe('mrrDashboardRouter — non-matching paths', () => {
  it('returns false for paths outside /analytics/mrr', async () => {
    const res = makeRes();
    const handled = await mrrDashboardRouter(makeReq('GET', '/other'), res, '/other');
    expect(handled).toBe(false);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('mrrDashboardRouter — validation', () => {
  it('returns 400 when merchantId is missing on GET', async () => {
    const res = makeRes();
    await mrrDashboardRouter(makeReq('GET', '/analytics/mrr'), res, '/analytics/mrr');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { success: boolean }).success).toBe(false);
  });

  it('returns 405 for DELETE on /analytics/mrr', async () => {
    const res = makeRes();
    await mrrDashboardRouter(
      makeReq('DELETE', `/analytics/mrr?merchantId=${MERCHANT}`),
      res, '/analytics/mrr'
    );
    expect(res.statusCode).toBe(405);
  });
});

// ─── POST /analytics/mrr/subscriptions ───────────────────────────────────────

describe('POST /analytics/mrr/subscriptions', () => {
  it('stores subscriptions and returns success', async () => {
    const res = makeRes();
    const handled = await mrrDashboardRouter(
      makeReq('POST', '/analytics/mrr/subscriptions', {
        merchantId: 'merch_seed_test',
        subscriptions: [makeSub()],
      }),
      res, '/analytics/mrr/subscriptions'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { success: boolean; data: { stored: number } }).data.stored).toBe(1);
  });

  it('returns 400 when merchantId is missing', async () => {
    const res = makeRes();
    await mrrDashboardRouter(
      makeReq('POST', '/analytics/mrr/subscriptions', { subscriptions: [] }),
      res, '/analytics/mrr/subscriptions'
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = {
      method: 'POST', url: '/analytics/mrr/subscriptions',
      headers: { host: 'localhost' },
      on(event: string, handler: (chunk?: unknown) => void) {
        if (event === 'data') handler(Buffer.from('{bad'));
        if (event === 'end') handler();
        return req;
      },
    } as unknown as http.IncomingMessage;
    const res = makeRes();
    await mrrDashboardRouter(req, res, '/analytics/mrr/subscriptions');
    expect(res.statusCode).toBe(400);
  });
});

// ─── GET /analytics/mrr (full dashboard) ─────────────────────────────────────

describe('GET /analytics/mrr', () => {
  it('returns a full dashboard snapshot with required fields', async () => {
    const res = makeRes();
    const handled = await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr?merchantId=${MERCHANT}`),
      res, '/analytics/mrr'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    const d = body.data;
    expect(d).toHaveProperty('mrr');
    expect(d).toHaveProperty('arr');
    expect(d).toHaveProperty('arrGrowthRate');
    expect(d).toHaveProperty('mrrGrowthRate');
    expect(d).toHaveProperty('subscriberCount');
    expect(d).toHaveProperty('breakdown');
    expect(d).toHaveProperty('trend');
    expect(d).toHaveProperty('churn');
    expect(d).toHaveProperty('forecast');
    expect(d).toHaveProperty('computedAt');
  });

  it('MRR is positive for seeded subscriptions', async () => {
    const res = makeRes();
    await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr?merchantId=${MERCHANT}`),
      res, '/analytics/mrr'
    );
    const data = (res.json() as { data: { mrr: number } }).data;
    expect(data.mrr).toBeGreaterThan(0);
  });

  it('ARR equals MRR * 12', async () => {
    const res = makeRes();
    await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr?merchantId=${MERCHANT}`),
      res, '/analytics/mrr'
    );
    const data = (res.json() as { data: { mrr: number; arr: number } }).data;
    expect(data.arr).toBeCloseTo(data.mrr * 12, 1);
  });
});

// ─── GET /analytics/mrr/breakdown ────────────────────────────────────────────

describe('GET /analytics/mrr/breakdown', () => {
  it('returns MRR movement components', async () => {
    const res = makeRes();
    const handled = await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr/breakdown?merchantId=${MERCHANT}`),
      res, '/analytics/mrr/breakdown'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data).toHaveProperty('newMrr');
    expect(data).toHaveProperty('expansionMrr');
    expect(data).toHaveProperty('contractionMrr');
    expect(data).toHaveProperty('churnMrr');
    expect(data).toHaveProperty('netNewMrr');
    expect(data).toHaveProperty('totalMrr');
  });

  it('newMrr is positive when curr has more subscriptions than prev', async () => {
    const res = makeRes();
    await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr/breakdown?merchantId=${MERCHANT}`),
      res, '/analytics/mrr/breakdown'
    );
    const data = (res.json() as { data: { newMrr: number } }).data;
    expect(data.newMrr).toBeGreaterThan(0);
  });
});

// ─── GET /analytics/mrr/arr ───────────────────────────────────────────────────

describe('GET /analytics/mrr/arr', () => {
  it('returns ARR, arrGrowthRate, impliedMonthlyGrowth', async () => {
    const res = makeRes();
    const handled = await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr/arr?merchantId=${MERCHANT}`),
      res, '/analytics/mrr/arr'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data).toHaveProperty('arr');
    expect(data).toHaveProperty('arrGrowthRate');
    expect(data).toHaveProperty('impliedMonthlyGrowth');
  });
});

// ─── GET /analytics/mrr/trend ────────────────────────────────────────────────

describe('GET /analytics/mrr/trend', () => {
  it('returns an array of trend points', async () => {
    const res = makeRes();
    const handled = await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr/trend?merchantId=${MERCHANT}`),
      res, '/analytics/mrr/trend'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('respects ?months= parameter (capped at 24)', async () => {
    const res = makeRes();
    await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr/trend?merchantId=${MERCHANT}&months=3`),
      res, '/analytics/mrr/trend'
    );
    expect(res.statusCode).toBe(200);
  });
});

// ─── GET /analytics/mrr/export ───────────────────────────────────────────────

describe('GET /analytics/mrr/export', () => {
  it('CSV: returns text/csv with Content-Disposition', async () => {
    const res = makeRes();
    const handled = await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr/export?merchantId=${MERCHANT}&format=csv`),
      res, '/analytics/mrr/export'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(res.headers['Content-Disposition']).toContain('attachment');
    expect(res.headers['Content-Disposition']).toContain('.csv');
  });

  it('CSV body contains MRR metric header', async () => {
    const res = makeRes();
    await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr/export?merchantId=${MERCHANT}&format=csv`),
      res, '/analytics/mrr/export'
    );
    expect(res.body).toContain('MRR');
  });

  it('JSON: returns application/json with Content-Disposition', async () => {
    const res = makeRes();
    await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr/export?merchantId=${MERCHANT}&format=json`),
      res, '/analytics/mrr/export'
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('application/json');
    expect(res.headers['Content-Disposition']).toContain('.json');
  });

  it('JSON body is a valid analytics envelope', async () => {
    const res = makeRes();
    await mrrDashboardRouter(
      makeReq('GET', `/analytics/mrr/export?merchantId=${MERCHANT}&format=json`),
      res, '/analytics/mrr/export'
    );
    const parsed = JSON.parse(res.body) as { merchantId: string; report: unknown };
    expect(parsed.merchantId).toBe(MERCHANT);
    expect(parsed.report).toBeDefined();
  });
});
