/**
 * Unit tests for cohortAnalyticsRouter.ts
 *
 * Covers:
 *  - GET /analytics/cohorts           → cohort table (monthly & weekly)
 *  - GET /analytics/cohorts/retention → Day 1/7/30/60/90 retention curve
 *  - GET /analytics/cohorts/churn     → revenue churn vs logo churn
 *  - GET /analytics/cohorts/export    → CSV and PDF download
 *  - GET /analytics/cohorts/mrr       → MRR/ARR/ARPU/LTV summary
 *  - POST /analytics/cohorts/subscribers → upsert subscriber record
 *  - Validation: missing merchantId → 400
 *  - Non-GET to read endpoint → 405
 *  - Unmatched sub-path → returns false
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import type http from 'node:http';
import { cohortAnalyticsRouter } from '../cohortAnalyticsRouter';
import { subscriberRecordRepository } from '../../services/analytics/subscriberRecordRepository';
import type { SubscriberRecord } from '../../../src/types/cohortAnalytics';

// ─── Minimal mock helpers ─────────────────────────────────────────────────────

type MockRes = http.ServerResponse & {
  statusCode: number;
  body: string;
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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = Date.now();
const TWO_MONTHS_AGO = NOW - 60 * 24 * 60 * 60 * 1000;
const ONE_MONTH_AGO  = NOW - 30 * 24 * 60 * 60 * 1000;
const MERCHANT = 'merch_test';

function makeRecord(overrides: Partial<SubscriberRecord> = {}): SubscriberRecord {
  return {
    subscriberId: `sub_${Math.random().toString(36).slice(2)}`,
    merchantId: MERCHANT,
    planId: 'plan_basic',
    planName: 'Basic',
    signupAt: TWO_MONTHS_AGO,
    mrr: 29,
    ...overrides,
  };
}

beforeEach(() => {
  subscriberRecordRepository.seed(MERCHANT, [
    makeRecord({ signupAt: TWO_MONTHS_AGO }),
    makeRecord({ signupAt: TWO_MONTHS_AGO }),
    makeRecord({
      signupAt: ONE_MONTH_AGO,
      churnedAt: ONE_MONTH_AGO + 5 * 24 * 60 * 60 * 1000,
    }),
  ]);
});

// ─── Non-matching paths ───────────────────────────────────────────────────────

describe('cohortAnalyticsRouter — non-matching paths', () => {
  it('returns false for paths outside /analytics/cohorts', async () => {
    const res = makeRes();
    const handled = await cohortAnalyticsRouter(makeReq('GET', '/other'), res, '/other');
    expect(handled).toBe(false);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('cohortAnalyticsRouter — validation', () => {
  it('returns 400 when merchantId missing', async () => {
    const res = makeRes();
    await cohortAnalyticsRouter(makeReq('GET', '/analytics/cohorts'), res, '/analytics/cohorts');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { success: boolean }).success).toBe(false);
  });

  it('returns 405 for non-GET to /analytics/cohorts', async () => {
    const res = makeRes();
    await cohortAnalyticsRouter(
      makeReq('DELETE', `/analytics/cohorts?merchantId=${MERCHANT}`),
      res,
      '/analytics/cohorts'
    );
    expect(res.statusCode).toBe(405);
  });
});

// ─── GET /analytics/cohorts (cohort table) ────────────────────────────────────

describe('GET /analytics/cohorts', () => {
  it('returns a cohort table array', async () => {
    const res = makeRes();
    const handled = await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts?merchantId=${MERCHANT}`),
      res, '/analytics/cohorts'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('buckets have required fields', async () => {
    const res = makeRes();
    await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts?merchantId=${MERCHANT}`),
      res, '/analytics/cohorts'
    );
    const bucket = (res.json() as { data: Array<Record<string, unknown>> }).data[0]!;
    expect(bucket).toHaveProperty('cohortKey');
    expect(bucket).toHaveProperty('size');
    expect(bucket).toHaveProperty('activeCount');
    expect(bucket).toHaveProperty('retentionRate');
  });

  it('accepts granularity=week and returns week-keyed buckets', async () => {
    const res = makeRes();
    await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts?merchantId=${MERCHANT}&granularity=week`),
      res, '/analytics/cohorts'
    );
    expect(res.statusCode).toBe(200);
    const buckets = (res.json() as { data: Array<{ granularity: string }> }).data;
    expect(buckets.every((b) => b.granularity === 'week')).toBe(true);
  });
});

// ─── GET /analytics/cohorts/retention ────────────────────────────────────────

describe('GET /analytics/cohorts/retention', () => {
  it('returns an array of retention curve points', async () => {
    const res = makeRes();
    const handled = await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts/retention?merchantId=${MERCHANT}`),
      res, '/analytics/cohorts/retention'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('each point has day, retainedCount, cohortSize, retentionRate', async () => {
    const res = makeRes();
    await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts/retention?merchantId=${MERCHANT}`),
      res, '/analytics/cohorts/retention'
    );
    const points = (res.json() as { data: Array<Record<string, unknown>> }).data;
    if (points.length > 0) {
      expect(points[0]).toHaveProperty('day');
      expect(points[0]).toHaveProperty('retainedCount');
      expect(points[0]).toHaveProperty('cohortSize');
      expect(points[0]).toHaveProperty('retentionRate');
    }
  });
});

// ─── GET /analytics/cohorts/churn ────────────────────────────────────────────

describe('GET /analytics/cohorts/churn', () => {
  it('returns churn breakdown with success=true', async () => {
    const res = makeRes();
    const handled = await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts/churn?merchantId=${MERCHANT}&from=${TWO_MONTHS_AGO}&to=${NOW}`),
      res, '/analytics/cohorts/churn'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { success: boolean }).success).toBe(true);
  });

  it('defaults from/to when params omitted', async () => {
    const res = makeRes();
    await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts/churn?merchantId=${MERCHANT}`),
      res, '/analytics/cohorts/churn'
    );
    expect(res.statusCode).toBe(200);
  });
});

// ─── GET /analytics/cohorts/mrr ───────────────────────────────────────────────

describe('GET /analytics/cohorts/mrr', () => {
  it('returns MRR/ARR/ARPU/LTV summary', async () => {
    const res = makeRes();
    const handled = await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts/mrr?merchantId=${MERCHANT}`),
      res, '/analytics/cohorts/mrr'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Record<string, unknown> }).data;
    expect(data).toHaveProperty('mrr');
    expect(data).toHaveProperty('arr');
    expect(data).toHaveProperty('arpu');
    expect(data).toHaveProperty('ltv');
    expect(data).toHaveProperty('activeCount');
    expect(data).toHaveProperty('subscriberCount');
  });

  it('mrr is positive for seeded data', async () => {
    const res = makeRes();
    await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts/mrr?merchantId=${MERCHANT}`),
      res, '/analytics/cohorts/mrr'
    );
    const data = (res.json() as { data: { mrr: number } }).data;
    expect(data.mrr).toBeGreaterThan(0);
  });
});

// ─── GET /analytics/cohorts/export ───────────────────────────────────────────

describe('GET /analytics/cohorts/export', () => {
  it('CSV: returns 200 with text/csv Content-Type and Content-Disposition', async () => {
    const res = makeRes();
    const handled = await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts/export?merchantId=${MERCHANT}&granularity=month&format=csv`),
      res, '/analytics/cohorts/export'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('text/csv');
    expect(res.headers['Content-Disposition']).toContain('attachment');
    expect(res.headers['Content-Disposition']).toContain('.csv');
  });

  it('CSV body contains expected column headers', async () => {
    const res = makeRes();
    await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts/export?merchantId=${MERCHANT}&format=csv`),
      res, '/analytics/cohorts/export'
    );
    expect(res.body).toContain('cohort');
    expect(res.body).toContain('retentionRate');
  });

  it('PDF: returns 200 with application/pdf Content-Type', async () => {
    const res = makeRes();
    await cohortAnalyticsRouter(
      makeReq('GET', `/analytics/cohorts/export?merchantId=${MERCHANT}&format=pdf`),
      res, '/analytics/cohorts/export'
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toContain('application/pdf');
  });
});

// ─── POST /analytics/cohorts/subscribers ─────────────────────────────────────

describe('POST /analytics/cohorts/subscribers', () => {
  it('upserts a record and returns success', async () => {
    const record: SubscriberRecord = makeRecord({ subscriberId: 'sub_new', merchantId: 'merch_new' });
    const res = makeRes();
    const handled = await cohortAnalyticsRouter(
      makeReq('POST', '/analytics/cohorts/subscribers', record),
      res, '/analytics/cohorts/subscribers'
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { success: boolean }).success).toBe(true);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      method: 'POST',
      url: '/analytics/cohorts/subscribers',
      headers: { host: 'localhost' },
      on(event: string, handler: (chunk?: unknown) => void) {
        if (event === 'data') handler(Buffer.from('{bad json'));
        if (event === 'end') handler();
        return req;
      },
    } as unknown as http.IncomingMessage;
    const res = makeRes();
    await cohortAnalyticsRouter(req, res, '/analytics/cohorts/subscribers');
    expect(res.statusCode).toBe(400);
  });
});
