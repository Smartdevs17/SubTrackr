/**
 * Integration tests for CDN-cacheable public API routes.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createApiServer } from '../../../server/createApiServer';
import { publicDataStore } from '../../store/publicDataStore';
import {
  CACHE_CONTROL_HEADER,
  SURROGATE_KEY_HEADER,
  CACHE_TAG_HEADER,
} from '../../../shared/middleware/cacheHeaders';

describe('Public API router (CDN cache headers)', () => {
  const app = createApiServer();

  beforeEach(() => {
    publicDataStore.reset();
  });

  it('GET /plans returns cache headers and surrogate keys', async () => {
    const res = await request(app).get('/plans').expect(200);

    expect(res.headers[cacheControlKey(res)]).toContain('s-maxage=300');
    expect(res.headers[cacheControlKey(res)]).toContain('stale-while-revalidate=60');
    expect(res.headers[surrogateKeyHeader(res)]).toContain('plan');
    expect(res.headers[cacheTagHeader(res)]).toContain('plan');
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /pricing honours x-cache-ttl', async () => {
    const res = await request(app).get('/pricing').set('x-cache-ttl', '120').expect(200);

    expect(res.headers[cacheControlKey(res)]).toContain('s-maxage=120');
    expect(res.headers[surrogateKeyHeader(res)]).toBe('pricing');
    expect(res.headers[cacheTagHeader(res)]).toBe('pricing');
  });

  it('GET /features returns feature surrogate key', async () => {
    const res = await request(app).get('/features').expect(200);

    expect(res.headers[surrogateKeyHeader(res)]).toBe('feature');
    expect(res.body.success).toBe(true);
  });

  it('GET /public/app/version returns scoped config surrogate keys', async () => {
    const res = await request(app).get('/public/app/version').expect(200);

    expect(res.headers[surrogateKeyHeader(res)]).toContain('config');
    expect(res.headers[surrogateKeyHeader(res)]).toContain('config:app/version');
    expect(res.body.data.key).toBe('app/version');
  });

  it('PATCH /plans/:id persists update and returns 200', async () => {
    const res = await request(app).patch('/plans/basic').send({ price: 5.49 }).expect(200);

    expect(res.body.data.price).toBe(5.49);

    const getRes = await request(app).get('/plans/basic').expect(200);
    expect(getRes.body.data.price).toBe(5.49);
  });

  it('PATCH /plans/:id returns 404 for unknown plan', async () => {
    await request(app).patch('/plans/unknown').send({ price: 1 }).expect(404);
  });

  it('PATCH /public/app/version persists and is readable', async () => {
    await request(app)
      .patch('/public/app/version')
      .send({ value: { minSupported: '2.0.0', latest: '2.0.0' } })
      .expect(200);

    const res = await request(app).get('/public/app/version').expect(200);
    expect(res.body.data.value).toEqual({ minSupported: '2.0.0', latest: '2.0.0' });
  });
});

function cacheControlKey(res: request.Response): string {
  return Object.keys(res.headers).find((k) => k.toLowerCase() === CACHE_CONTROL_HEADER.toLowerCase())!;
}

function surrogateKeyHeader(res: request.Response): string {
  return Object.keys(res.headers).find((k) => k.toLowerCase() === SURROGATE_KEY_HEADER.toLowerCase())!;
}

function cacheTagHeader(res: request.Response): string {
  return Object.keys(res.headers).find((k) => k.toLowerCase() === CACHE_TAG_HEADER.toLowerCase())!;
}
