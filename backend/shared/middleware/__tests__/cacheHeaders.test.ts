/**
 * Tests for CDN edge-cache header middleware.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  DEFAULT_CACHE_TTL_SECONDS,
  STALE_WHILE_REVALIDATE_SECONDS,
  buildCacheControlHeader,
  clampTtl,
  resolveTtlFromRequest,
  applyCacheHeaders,
  isCacheableRoute,
  cacheHeadersMiddleware,
  CACHE_CONTROL_HEADER,
  SURROGATE_KEY_HEADER,
} from '../cacheHeaders';

// ── buildCacheControlHeader ───────────────────────────────────────────────────

describe('buildCacheControlHeader', () => {
  it('uses default TTL and stale-while-revalidate', () => {
    const header = buildCacheControlHeader();
    expect(header).toBe(
      `public, s-maxage=${DEFAULT_CACHE_TTL_SECONDS}, max-age=${DEFAULT_CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
    );
  });

  it('honours custom TTL', () => {
    const header = buildCacheControlHeader(120);
    expect(header).toContain('s-maxage=120');
    expect(header).toContain('max-age=120');
  });

  it('honours custom stale-while-revalidate', () => {
    const header = buildCacheControlHeader(300, 30);
    expect(header).toContain('stale-while-revalidate=30');
  });
});

// ── clampTtl ──────────────────────────────────────────────────────────────────

describe('clampTtl', () => {
  it('returns default for non-finite values', () => {
    expect(clampTtl(NaN)).toBe(DEFAULT_CACHE_TTL_SECONDS);
    expect(clampTtl(0)).toBe(DEFAULT_CACHE_TTL_SECONDS);
    expect(clampTtl(-10)).toBe(DEFAULT_CACHE_TTL_SECONDS);
  });

  it('clamps to minimum of 1 second', () => {
    expect(clampTtl(0.5)).toBe(1);
  });

  it('clamps to maximum of 3600 seconds', () => {
    expect(clampTtl(9999)).toBe(3600);
  });

  it('floors fractional values', () => {
    expect(clampTtl(150.9)).toBe(150);
  });
});

// ── resolveTtlFromRequest ─────────────────────────────────────────────────────

describe('resolveTtlFromRequest', () => {
  it('returns default when header is absent', () => {
    expect(resolveTtlFromRequest({ headers: {} })).toBe(DEFAULT_CACHE_TTL_SECONDS);
  });

  it('parses x-cache-ttl header', () => {
    expect(resolveTtlFromRequest({ headers: { 'x-cache-ttl': '120' } })).toBe(120);
  });

  it('falls back to default for invalid header', () => {
    expect(resolveTtlFromRequest({ headers: { 'x-cache-ttl': 'abc' } })).toBe(
      DEFAULT_CACHE_TTL_SECONDS,
    );
  });

  it('handles array header values', () => {
    expect(resolveTtlFromRequest({ headers: { 'x-cache-ttl': ['60', '120'] } })).toBe(60);
  });

  it('clamps out-of-range values', () => {
    expect(resolveTtlFromRequest({ headers: { 'x-cache-ttl': '99999' } })).toBe(3600);
  });
});

// ── applyCacheHeaders ─────────────────────────────────────────────────────────

describe('applyCacheHeaders', () => {
  it('sets Cache-Control header', () => {
    const headers: Record<string, string> = {};
    const target = { setHeader: (k: string, v: string) => { headers[k] = v; } };

    applyCacheHeaders(target, { ttlSeconds: 300 });

    expect(headers[CACHE_CONTROL_HEADER]).toContain('s-maxage=300');
    expect(headers[CACHE_CONTROL_HEADER]).toContain('stale-while-revalidate=60');
  });

  it('sets Surrogate-Key header when keys provided', () => {
    const headers: Record<string, string> = {};
    const target = { setHeader: (k: string, v: string) => { headers[k] = v; } };

    applyCacheHeaders(target, { surrogateKeys: ['plan', 'plan:basic'] });

    expect(headers[SURROGATE_KEY_HEADER]).toBe('plan plan:basic');
    expect(headers['Cache-Tag']).toBe('plan plan:basic');
  });

  it('deduplicates surrogate keys', () => {
    const headers: Record<string, string> = {};
    const target = { setHeader: (k: string, v: string) => { headers[k] = v; } };

    applyCacheHeaders(target, { surrogateKeys: ['plan', 'plan', 'pricing'] });

    expect(headers[SURROGATE_KEY_HEADER]).toBe('plan pricing');
  });

  it('omits Surrogate-Key when keys array is empty', () => {
    const headers: Record<string, string> = {};
    const target = { setHeader: (k: string, v: string) => { headers[k] = v; } };

    applyCacheHeaders(target, { surrogateKeys: [] });

    expect(headers[SURROGATE_KEY_HEADER]).toBeUndefined();
  });
});

// ── isCacheableRoute ──────────────────────────────────────────────────────────

describe('isCacheableRoute', () => {
  it('matches GET /plans', () => {
    expect(isCacheableRoute('GET', '/plans')).toBe(true);
    expect(isCacheableRoute('get', '/plans/')).toBe(true);
  });

  it('matches GET /pricing', () => {
    expect(isCacheableRoute('GET', '/pricing')).toBe(true);
  });

  it('matches GET /features', () => {
    expect(isCacheableRoute('GET', '/features')).toBe(true);
  });

  it('matches GET /public/* paths', () => {
    expect(isCacheableRoute('GET', '/public')).toBe(true);
    expect(isCacheableRoute('GET', '/public/app/version')).toBe(true);
    expect(isCacheableRoute('GET', '/public/billing/currencies')).toBe(true);
  });

  it('rejects non-GET methods', () => {
    expect(isCacheableRoute('POST', '/plans')).toBe(false);
    expect(isCacheableRoute('PATCH', '/pricing')).toBe(false);
  });

  it('rejects non-cacheable paths', () => {
    expect(isCacheableRoute('GET', '/subscriptions')).toBe(false);
    expect(isCacheableRoute('GET', '/private/config')).toBe(false);
  });

  it('strips query string before matching', () => {
    expect(isCacheableRoute('GET', '/plans?cursor=abc')).toBe(true);
  });
});

// ── cacheHeadersMiddleware ────────────────────────────────────────────────────

describe('cacheHeadersMiddleware', () => {
  function makeReqRes(method: string, path: string, headers: Record<string, string> = {}) {
    const req = {
      method,
      path,
      headers,
    } as any;

    const headersOut: Record<string, string> = {};
    const res = {
      headersSent: false,
      locals: {} as Record<string, unknown>,
      setHeader: (k: string, v: string) => { headersOut[k] = v; },
      end: jest.fn(function (this: any) { return this; }),
    } as any;

    const originalEnd = res.end;
    res.end = jest.fn(function (this: any, ...args: unknown[]) {
      return originalEnd.apply(this, args);
    });

    const next = jest.fn();
    return { req, res, headersOut, next };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips non-GET requests', () => {
    const { req, res, next } = makeReqRes('POST', '/plans');
    cacheHeadersMiddleware()(req, res, next);
    res.end();
    expect(next).toHaveBeenCalled();
  });

  it('skips non-cacheable routes when routeFilter is true', () => {
    const { req, res, next } = makeReqRes('GET', '/subscriptions');
    cacheHeadersMiddleware()(req, res, next);
    res.end();
    expect(next).toHaveBeenCalled();
  });

  it('applies cache headers on response end for cacheable routes', () => {
    const { req, res, next, headersOut } = makeReqRes('GET', '/plans');
    res.locals.surrogateKeys = ['plan'];

    cacheHeadersMiddleware()(req, res, next);
    res.end();

    expect(headersOut[CACHE_CONTROL_HEADER]).toContain('s-maxage=300');
    expect(headersOut[SURROGATE_KEY_HEADER]).toBe('plan');
  });

  it('respects x-cache-ttl from request', () => {
    const { req, res, next, headersOut } = makeReqRes('GET', '/pricing', { 'x-cache-ttl': '60' });

    cacheHeadersMiddleware()(req, res, next);
    res.end();

    expect(headersOut[CACHE_CONTROL_HEADER]).toContain('s-maxage=60');
  });
});
