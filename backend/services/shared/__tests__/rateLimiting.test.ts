/**
 * Tests — RateLimitingService + rateLimitMiddleware (Issue #998)
 */

import { RateLimitingService } from '../rateLimitingService';
import {
  createRateLimitMiddleware,
  createIpRateLimitMiddleware,
  type MinimalRequest,
  type MinimalResponse,
  type NextFn,
} from '../rateLimitMiddleware';
import { SubscriptionTier } from '../../../src/types/subscription';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<MinimalRequest> = {}): MinimalRequest {
  return {
    headers: { 'x-api-key': 'sk_test_abc123' },
    path: '/api/subscriptions',
    method: 'GET',
    ...overrides,
  };
}

function makeRes(): MinimalResponse & {
  _status: number;
  _headers: Record<string, string>;
  _body: unknown;
} {
  const res = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _body: undefined as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    set(header: string, value: string) {
      res._headers[header] = value;
      return res;
    },
    json(body: unknown) {
      res._body = body;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// RateLimitingService
// ---------------------------------------------------------------------------

describe('RateLimitingService', () => {
  let service: RateLimitingService;

  beforeEach(() => {
    service = new RateLimitingService();
  });

  // ── bypass ────────────────────────────────────────────────────────────────

  describe('bypass', () => {
    it('bypasses a known key', () => {
      service.addBypassKey('internal_key');
      const result = service.checkRateLimit('internal_key', SubscriptionTier.FREE);
      expect(result.allowed).toBe(true);
    });

    it('can remove bypass key', () => {
      service.addBypassKey('k');
      service.removeBypassKey('k');
      expect(service.isBypassed('k')).toBe(false);
    });

    it('bypasses a user', () => {
      service.addBypassUser('admin_user');
      expect(service.checkUserRateLimit('user:admin_user', SubscriptionTier.FREE).allowed).toBe(true);
    });
  });

  // ── checkRateLimit ────────────────────────────────────────────────────────

  describe('checkRateLimit', () => {
    it('allows first request for any tier', () => {
      expect(service.checkRateLimit('key1', SubscriptionTier.FREE).allowed).toBe(true);
      expect(service.checkRateLimit('key2', SubscriptionTier.PREMIUM).allowed).toBe(true);
    });

    it('blocks burst when tokens exhausted', () => {
      service.setBurstTokens('key_burst', 0, SubscriptionTier.FREE);
      const result = service.checkRateLimit('key_burst', SubscriptionTier.FREE);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });
  });

  // ── recordRequest ─────────────────────────────────────────────────────────

  describe('recordRequest', () => {
    it('increments usage counters', () => {
      service.recordRequest('key_r', SubscriptionTier.FREE, '/api/subs', 200, 50);
      service.recordRequest('key_r', SubscriptionTier.FREE, '/api/subs', 200, 40);
      const usage = service.getUsage('key_r')!;
      expect(usage.hourly).toBe(2);
      expect(usage.daily).toBe(2);
      expect(usage.monthly).toBe(2);
    });

    it('emits soft warning near limit', () => {
      service.setCustomLimits('key_soft', { hourlyLimit: 10 });
      for (let i = 0; i < 8; i++) {
        service.recordRequest('key_soft', SubscriptionTier.FREE, '/x', 200, 10);
      }
      const { softWarning } = service.recordRequest('key_soft', SubscriptionTier.FREE, '/x', 200, 10);
      expect(softWarning).toBeDefined();
      expect(softWarning!.usagePercent).toBeGreaterThanOrEqual(80);
    });
  });

  // ── custom limits ─────────────────────────────────────────────────────────

  describe('custom limits', () => {
    it('overrides tier defaults', () => {
      service.setCustomLimits('key_c', { hourlyLimit: 5 });
      const limits = service.getEffectiveLimits('key_c', SubscriptionTier.FREE);
      expect(limits.hourlyLimit).toBe(5);
    });

    it('clears custom limits and falls back to tier', () => {
      service.setCustomLimits('key_c', { hourlyLimit: 5 });
      service.clearCustomLimits('key_c');
      // Just check no error thrown and defaults are restored
      const limits = service.getEffectiveLimits('key_c', SubscriptionTier.FREE);
      expect(limits.hourlyLimit).toBeGreaterThan(5);
    });
  });

  // ── per-user limits ───────────────────────────────────────────────────────

  describe('per-user limits', () => {
    it('tracks user usage separately from key usage', () => {
      service.recordUserRequest('user:alice', SubscriptionTier.FREE, '/api/subs');
      const status = service.getUserRateLimitStatus('user:alice', SubscriptionTier.FREE);
      expect(status.current.hourly).toBe(1);
    });

    it('allows user if within limit', () => {
      const result = service.checkUserRateLimit('user:bob', SubscriptionTier.PREMIUM);
      expect(result.allowed).toBe(true);
    });
  });

  // ── analytics ─────────────────────────────────────────────────────────────

  describe('analytics', () => {
    it('returns zeroed analytics on fresh service', () => {
      const a = service.getAnalytics();
      expect(a.totalRequests).toBe(0);
      expect(a.errorRate).toBe(0);
    });

    it('tracks rate limit hit rate', () => {
      service.recordRequest('k', SubscriptionTier.FREE, '/x', 200, 10);
      service.recordRequest('k', SubscriptionTier.FREE, '/x', 429, 5);
      const a = service.getRateLimitAnalytics();
      expect(a.rateLimitHits).toBe(1);
      expect(a.hitRate).toBeCloseTo(0.5);
    });

    it('reports top throttled endpoints', () => {
      for (let i = 0; i < 3; i++) {
        service.recordRequest('k', SubscriptionTier.FREE, '/hot', 429, 5);
      }
      service.recordRequest('k', SubscriptionTier.FREE, '/cold', 429, 5);
      const { topThrottledEndpoints } = service.getRateLimitAnalytics();
      expect(topThrottledEndpoints[0]!.endpoint).toBe('/hot');
      expect(topThrottledEndpoints[0]!.hits).toBe(3);
    });
  });

  // ── tier upgrade ──────────────────────────────────────────────────────────

  describe('tier upgrade recommendation', () => {
    it('returns null for unknown key', () => {
      expect(service.checkTierUpgrade('no_key')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// rateLimitMiddleware
// ---------------------------------------------------------------------------

describe('rateLimitMiddleware', () => {
  let service: RateLimitingService;

  beforeEach(() => {
    service = new RateLimitingService();
  });

  it('passes request with valid key', async () => {
    const middleware = createRateLimitMiddleware({ service, allowMissingKey: false });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn() as NextFn;

    await middleware(req, res as unknown as MinimalResponse, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when key is missing', async () => {
    const middleware = createRateLimitMiddleware({ service });
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = jest.fn() as NextFn;

    await middleware(req, res as unknown as MinimalResponse, next);
    expect(res._status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 429 when burst tokens exhausted', async () => {
    const middleware = createRateLimitMiddleware({ service });
    service.setBurstTokens('sk_test_abc123', 0, SubscriptionTier.FREE);

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn() as NextFn;

    await middleware(req, res as unknown as MinimalResponse, next);
    expect(res._status).toBe(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets X-RateLimit-* headers on allowed requests', async () => {
    const middleware = createRateLimitMiddleware({ service });
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn() as NextFn;

    await middleware(req, res as unknown as MinimalResponse, next);
    expect(res._headers['X-RateLimit-Limit']).toBeDefined();
    expect(res._headers['X-RateLimit-Remaining']).toBeDefined();
    expect(res._headers['X-RateLimit-Reset']).toBeDefined();
    expect(res._headers['X-RateLimit-Burst-Remaining']).toBeDefined();
  });

  it('skips rate limiting for configured bypass paths', async () => {
    const middleware = createRateLimitMiddleware({
      service,
      skipPaths: ['/health'],
    });
    const req = makeReq({ path: '/health', headers: {} });
    const res = makeRes();
    const next = jest.fn() as NextFn;

    await middleware(req, res as unknown as MinimalResponse, next);
    expect(next).toHaveBeenCalled();
    expect(res._status).toBe(200); // not set to 401
  });

  it('uses custom rate limit exceeded body', async () => {
    const middleware = createRateLimitMiddleware({
      service,
      rateLimitExceededBody: (ms) => ({ custom: true, retryAfterMs: ms }),
    });
    service.setBurstTokens('sk_test_abc123', 0, SubscriptionTier.FREE);

    const req = makeReq();
    const res = makeRes();
    const next = jest.fn() as NextFn;

    await middleware(req, res as unknown as MinimalResponse, next);
    expect((res._body as Record<string, unknown>)['custom']).toBe(true);
  });

  it('IP rate limit middleware extracts IP as key', async () => {
    const middleware = createIpRateLimitMiddleware({ service });
    const req = makeReq({
      headers: {},
      ip: '127.0.0.1',
    });
    const res = makeRes();
    const next = jest.fn() as NextFn;

    await middleware(req, res as unknown as MinimalResponse, next);
    expect(next).toHaveBeenCalled();
    // Usage should exist under ip:127.0.0.1
    const usage = service.getUsage('ip:127.0.0.1');
    expect(usage).toBeDefined();
  });
});
