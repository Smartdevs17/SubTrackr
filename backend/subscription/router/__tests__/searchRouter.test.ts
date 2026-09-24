import { describe, it, expect, beforeAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';

import { Subscription } from '../../../../src/types/subscription';
import { elasticsearchService } from '../../../services/search/ElasticsearchService';
import { createSearchRouter } from '../searchRouter';

const makeSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
  id: `sub_${Math.random().toString(36).slice(2)}`,
  name: 'Test Service',
  category: 'other' as Subscription['category'],
  price: 9.99,
  currency: 'USD',
  billingCycle: 'monthly' as Subscription['billingCycle'],
  nextBillingDate: new Date('2026-11-01T00:00:00.000Z'),
  isActive: true,
  isCryptoEnabled: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const seed = [
  makeSubscription({
    id: 'seed-netflix',
    name: 'Netflix',
    category: 'streaming' as Subscription['category'],
    price: 15.99,
    isActive: true,
    isCryptoEnabled: true,
  }),
  makeSubscription({
    id: 'seed-spotify',
    name: 'Spotify',
    category: 'streaming' as Subscription['category'],
    price: 9.99,
    isActive: false,
    isPaused: true,
  }),
  makeSubscription({
    id: 'seed-copilot',
    name: 'GitHub Copilot',
    category: 'software' as Subscription['category'],
    price: 100,
    billingCycle: 'yearly' as Subscription['billingCycle'],
  }),
];

describe('Search REST API', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/search', createSearchRouter());

  beforeAll(() => {
    elasticsearchService.bulkIndex(seed);
  });

  it('GET /api/v1/search/subscriptions returns the search envelope', async () => {
    const res = await request(app).get('/api/v1/search/subscriptions').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.meta.pagination.total).toBe(3);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.hits).toHaveLength(3);
    expect(res.body.data.hits[0].subscription.name).toBe('Netflix');
  });

  it('filters by query text', async () => {
    const res = await request(app).get('/api/v1/search/subscriptions?q=netflix').expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.hits[0].subscription.name).toBe('Netflix');
  });

  it('maps paused status to inactive when filtering', async () => {
    const res = await request(app).get('/api/v1/search/subscriptions?status=paused').expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.hits[0].subscription.name).toBe('Spotify');
  });

  it('filters by price range', async () => {
    const res = await request(app).get('/api/v1/search/subscriptions?minPrice=50').expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.hits[0].subscription.name).toBe('GitHub Copilot');
  });

  it('paginates results and reports hasMore', async () => {
    const res = await request(app).get('/api/v1/search/subscriptions?pageSize=2').expect(200);

    expect(res.body.data.hits).toHaveLength(2);
    expect(res.body.meta.pagination.hasMore).toBe(true);
  });

  it('creates, lists and deletes a saved search', async () => {
    const created = await request(app)
      .post('/api/v1/search/saved')
      .send({ name: 'Streaming picks', query: { query: 'netflix', size: 5 } })
      .expect(200);

    expect(created.body.success).toBe(true);
    expect(created.body.data.name).toBe('Streaming picks');

    const savedId: string = created.body.data.id;
    const list = await request(app).get('/api/v1/search/saved').expect(200);
    expect(list.body.data.some((s: { id: string }) => s.id === savedId)).toBe(true);

    const del = await request(app).delete(`/api/v1/search/saved/${savedId}`).expect(200);
    expect(del.body.data.deleted).toBe(true);

    const after = await request(app).get('/api/v1/search/saved').expect(200);
    expect(after.body.data.some((s: { id: string }) => s.id === savedId)).toBe(false);
  });

  it('returns 404 when deleting an unknown saved search', async () => {
    const res = await request(app).delete('/api/v1/search/saved/does-not-exist').expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('validates saved search input', async () => {
    const res = await request(app)
      .post('/api/v1/search/saved')
      .send({ name: 'Missing query' })
      .expect(422);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});