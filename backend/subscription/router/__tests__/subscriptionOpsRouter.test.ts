/**
 * Integration tests for pause/resume, batching and branding routes (Issues
 * #1109 adjacent, #1110, #1113, #1116).
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApiServer } from '../../../server/createApiServer';
import { pauseStateStore } from '../../domain/pauseStateStore';
import { batchRunStore } from '../../domain/batchRunStore';
import { portalBrandingStore } from '../../domain/portalBranding';

describe('subscription pause/resume routes', () => {
  const app = createApiServer();

  beforeEach(() => {
    pauseStateStore.reset();
  });

  it('previews the billing adjustment without persisting state', async () => {
    const res = await request(app)
      .post('/subscriptions/sub_1/pause/preview')
      .send({ price: 30, currency: 'USD', pauseDays: 15 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.adjustment.creditAmount).toBe(15);
    expect(res.body.data.adjustment.remainingBalance).toBe(15);
    expect(res.body.data.scheduledResumeAt).toBeDefined();
    expect(pauseStateStore.list()).toHaveLength(0);
  });

  it('pauses a subscription and returns the credit', async () => {
    const res = await request(app)
      .post('/subscriptions/sub_1/pause')
      .send({ price: 30, currency: 'USD', pauseDays: 14, reason: 'vacation' })
      .expect(201);

    expect(res.body.data.session.status).toBe('paused');
    expect(res.body.data.adjustment.creditAmount).toBe(14);
    expect(res.body.data.earlyResumeCredit).toBe(14);
  });

  it('rejects an invalid reason', async () => {
    const res = await request(app)
      .post('/subscriptions/sub_1/pause')
      .send({ price: 30, pauseDays: 14, reason: 'nope' })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a second pause while one is active', async () => {
    await request(app)
      .post('/subscriptions/sub_1/pause')
      .send({ price: 30, pauseDays: 14 })
      .expect(201);

    const res = await request(app)
      .post('/subscriptions/sub_1/pause')
      .send({ price: 30, pauseDays: 14 })
      .expect(409);

    expect(res.body.error.code).toBe('SUBSCRIPTION_PAUSED');
  });

  it('resumes and reports the remaining credit', async () => {
    await request(app)
      .post('/subscriptions/sub_1/pause')
      .send({ price: 30, pauseDays: 14 })
      .expect(201);

    const res = await request(app)
      .post('/subscriptions/sub_1/pause/resume')
      .send({ early: true })
      .expect(200);

    expect(res.body.data.session.status).toBe('resumed');
    expect(res.body.data.earlyResumeCredit).toBeGreaterThanOrEqual(0);
  });

  it('returns 404 when resuming a subscription that is not paused', async () => {
    const res = await request(app)
      .post('/subscriptions/unknown/pause/resume')
      .send({})
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it('returns pause history', async () => {
    await request(app)
      .post('/subscriptions/sub_1/pause')
      .send({ price: 30, pauseDays: 14 })
      .expect(201);

    const res = await request(app).get('/subscriptions/sub_1/pause').expect(200);
    expect(res.body.data.history).toHaveLength(1);
    expect(res.body.data.active).not.toBeNull();
  });
});

describe('subscription batch routes', () => {
  const app = createApiServer();

  beforeEach(() => {
    batchRunStore.reset();
  });

  it('executes a batch and reports gas savings', async () => {
    const res = await request(app)
      .post('/subscriptions/batch')
      .send({
        atomic: true,
        operations: [
          { operation: 'charge', subscriptionId: 'a' },
          { operation: 'charge', subscriptionId: 'b' },
        ],
      })
      .expect(201);

    expect(res.body.data.results).toHaveLength(2);
    expect(res.body.data.summary.successRate).toBe(1);
    expect(res.body.data.summary.gasSaved).toBeGreaterThan(0);
    expect(res.body.data.rolledBack).toBe(false);
  });

  it('rejects an empty batch', async () => {
    const res = await request(app)
      .post('/subscriptions/batch')
      .send({ operations: [] })
      .expect(422);

    expect(res.body.error.code).toBe('USAGE_INVALID_EVENT');
  });

  it('rejects malformed operations', async () => {
    const res = await request(app)
      .post('/subscriptions/batch')
      .send({ operations: [{ operation: 'charge' }] })
      .expect(422);

    expect(res.body.success).toBe(false);
  });

  it('serves aggregate statistics across runs', async () => {
    await request(app)
      .post('/subscriptions/batch')
      .send({ operations: [{ operation: 'charge', subscriptionId: 'a' }] })
      .expect(201);

    const res = await request(app).get('/subscriptions/batch/stats').expect(200);
    expect(res.body.data.runs).toBe(1);
    expect(res.body.data.totalOperations).toBe(1);
    expect(res.body.data.gasSaved).toBeGreaterThan(0);
    expect(res.body.data.gasModel.singleTransactionGas).toBe(150_000);
  });

  it('fetches a single run by id', async () => {
    const created = await request(app)
      .post('/subscriptions/batch')
      .send({ operations: [{ operation: 'charge', subscriptionId: 'a' }] })
      .expect(201);

    const res = await request(app)
      .get(`/subscriptions/batch/${created.body.data.id}`)
      .expect(200);

    expect(res.body.data.id).toBe(created.body.data.id);
  });

  it('404s for an unknown run', async () => {
    const res = await request(app).get('/subscriptions/batch/missing').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('tenant branding routes', () => {
  const app = createApiServer();

  beforeEach(() => {
    portalBrandingStore.reset();
  });

  it('returns the default branding', async () => {
    const res = await request(app)
      .get('/api/v1/merchant/branding')
      .set('x-merchant-id', 'default')
      .expect(200);

    expect(res.body.data.merchantId).toBe('default');
    expect(res.body.data.colors.primary).toBeDefined();
  });

  it('stores merchant branding and renders portal CSS', async () => {
    const saved = await request(app)
      .put('/api/v1/merchant/branding')
      .set('x-merchant-id', 'merchant_7')
      .send({
        brandName: 'Seven',
        logo: { uri: 'https://cdn.seven.test/logo.svg', altText: 'Seven' },
        colors: { primary: '#123456' },
      })
      .expect(200);

    expect(saved.body.data.brandName).toBe('Seven');

    const portal = await request(app)
      .get('/api/v1/merchant/branding/portal')
      .set('x-merchant-id', 'merchant_7')
      .expect(200);

    expect(portal.body.data.brandName).toBe('Seven');
    expect(portal.body.data.cssVariables['--st-portal-primary']).toBe('#123456');
    expect(portal.body.data.cssVariables['--st-portal-logo']).toBe(
      'url(https://cdn.seven.test/logo.svg)'
    );
    expect(portal.body.data.stylesheet).toContain('--st-portal-primary: #123456;');
  });

  it('rejects invalid branding payloads', async () => {
    const res = await request(app)
      .put('/api/v1/merchant/branding')
      .set('x-merchant-id', 'merchant_7')
      .send({ colors: { primary: 'not-a-color' } })
      .expect(422);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
