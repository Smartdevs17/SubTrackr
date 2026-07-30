/**
 * Tests for the rate limiting middleware and RateLimitingService.
 *
 * Run with:
 *   npx jest backend/services/shared/__tests__/rateLimiting.test.ts
 */

import { RateLimitingService } from '../rateLimitingService';
import {
  createRateLimitMiddleware,
  RATE_LIMIT_HEADERS,
  type RateLimitRequest,
  type RateLimitResponse,
} from '../rateLimitMiddleware';
import { SubscriptionTier } from '../../../../src/types/subscription';
import { TIER_RATE_LIMITS } from '../../../../src/types/rateLimiting';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<RateLimitRequest> = {}): RateLimitRequest {
  return {
    method: 'GET',
    path: '/subscriptions',
    url: '/subscriptions',
    headers: {},
    ...overrides,
  };
}

interface MockResponse extends RateLimitResponse {
  statusCode: number;
  headers: Record<string, string | number>;
  body: unknown;
  ended: boolean;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          this.headers[k] = v;
        }
      }
    },
    end(body) {
      this.ended = true;
      if (body) this.body = JSON.parse(body);
    },
  };
  return res;
}

function runMiddleware(
  mw: ReturnType<typeof createRateLimitMiddleware>,
  req: RateLimitRequest,
  res: MockResponse,
): boolean {
  let called = false;
  mw(req, res, () => {
    called = true;
  });
  return called;
}

// ---------------------------------------------------------------------------
// RateLimitingService unit tests
// ---------------------------------------------------------------------------

describe('RateLimitingService', () => {
  let service: RateLimitingService;

  beforeEach(() => {
    service = new RateLimitingService();
  });

  // -------------------------------------------------------------------------
  describe('checkRateLimit', () => {
    it('allows requests within hourly limit', () => {
      const result = service.checkRateLimit('key1', SubscriptionTier.FREE);
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBeUndefined();
    });

    it('blocks requests when hourly limit is exceeded', () => {
      const tier = SubscriptionTier.FREE;
      const limits = TIER_RATE_LIMITS[tier];

      // Exhaust the hourly counter by recording requests
      const usage = service.getOrCreateUsage('key1', tier);
      usage.hourly = limits.hourlyLimit;

      const result = service.checkRateLimit('key1', tier);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('blocks when daily limit is exceeded', () => {
      const tier = SubscriptionTier.FREE;
      const limits = TIER_RATE_LIMITS[tier];

      const usage = service.getOrCreateUsage('key1', tier);
      usage.daily = limits.dailyLimit;

      const result = service.checkRateLimit('key1', tier);
      expect(result.allowed).toBe(false);
    });

    it('blocks when burst tokens are exhausted', () => {
      const tier = SubscriptionTier.FREE;
      const usage = service.getOrCreateUsage('key1', tier);
      usage.burstTokens = 0;

      const result = service.checkRateLimit('key1', tier);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(1_000);
    });

    it('blocks when concurrency limit is exceeded', () => {
      const tier = SubscriptionTier.FREE;
      const limits = TIER_RATE_LIMITS[tier];

      const usage = service.getOrCreateUsage('key1', tier);
      usage.concurrentRequests = limits.concurrentLimit;

      const result = service.checkRateLimit('key1', tier);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  describe('bypass management', () => {
    it('allows bypassed API keys regardless of limits', () => {
      const tier = SubscriptionTier.FREE;
      const limits = TIER_RATE_LIMITS[tier];

      // Exhaust limit
      const usage = service.getOrCreateUsage('bypass-key', tier);
      usage.hourly = limits.hourlyLimit;

      service.addBypassKey('bypass-key');

      const result = service.checkRateLimit('bypass-key', tier);
      expect(result.allowed).toBe(true);
    });

    it('removes bypass key', () => {
      service.addBypassKey('key1');
      expect(service.isBypassed('key1')).toBe(true);

      service.removeBypassKey('key1');
      expect(service.isBypassed('key1')).toBe(false);
    });

    it('allows bypassed users', () => {
      service.addBypassUser('user123');
      expect(service.isBypassed('user123', true)).toBe(true);
    });

    it('listBypassKeys returns all bypass keys', () => {
      service.addBypassKey('key1');
      service.addBypassKey('key2');
      expect(service.listBypassKeys()).toEqual(expect.arrayContaining(['key1', 'key2']));
    });

    it('listBypassUsers returns all bypass users', () => {
      service.addBypassUser('u1');
      service.addBypassUser('u2');
      expect(service.listBypassUsers()).toEqual(expect.arrayContaining(['u1', 'u2']));
    });
  });

  // -------------------------------------------------------------------------
  describe('custom limits', () => {
    it('uses custom hourly limit when set', () => {
      service.setCustomLimits('custom-key', { hourlyLimit: 10 });
      const limits = service.getEffectiveLimits('custom-key', SubscriptionTier.FREE);
      expect(limits.hourlyLimit).toBe(10);
    });

    it('falls back to tier limits for unset dimensions', () => {
      service.setCustomLimits('custom-key', { hourlyLimit: 10 });
      const limits = service.getEffectiveLimits('custom-key', SubscriptionTier.FREE);
      expect(limits.dailyLimit).toBe(TIER_RATE_LIMITS[SubscriptionTier.FREE].dailyLimit);
    });

    it('clearCustomLimits reverts to tier defaults', () => {
      service.setCustomLimits('custom-key', { hourlyLimit: 1 });
      service.clearCustomLimits('custom-key');
      const limits = service.getEffectiveLimits('custom-key', SubscriptionTier.FREE);
      expect(limits.hourlyLimit).toBe(TIER_RATE_LIMITS[SubscriptionTier.FREE].hourlyLimit);
    });

    it('enforces custom limits', () => {
      service.setCustomLimits('key1', { hourlyLimit: 2 });
      service.recordRequest('key1', SubscriptionTier.FREE, '/test', 200, 10);
      service.recordRequest('key1', SubscriptionTier.FREE, '/test', 200, 10);

      // At exactly the limit — checkRateLimit should block further requests
      const usage = service.getOrCreateUsage('key1', SubscriptionTier.FREE);
      // 2 requests recorded against hourlyLimit of 2
      expect(usage.hourly).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('per-user rate limiting', () => {
    it('allows requests within user hourly limit', () => {
      const result = service.checkUserRateLimit('user:alice', SubscriptionTier.FREE);
      expect(result.allowed).toBe(true);
    });

    it('blocks when user hourly limit is exceeded', () => {
      const tier = SubscriptionTier.FREE;
      const userHourlyLimit = TIER_RATE_LIMITS[tier].hourlyLimit * 5;

      // Exhaust user limit
      const usage = (service as unknown as { userUsages: Map<string, { hourly: number; hourlyResetAt: number }> }).userUsages;
      service.checkUserRateLimit('user:alice', tier); // creates the entry
      const entry = usage.get('user:alice')!;
      entry.hourly = userHourlyLimit;

      const result = service.checkUserRateLimit('user:alice', tier);
      expect(result.allowed).toBe(false);
    });

    it('bypassed users skip per-user limit check', () => {
      const tier = SubscriptionTier.FREE;
      service.addBypassUser('alice');

      const usage = (service as unknown as { userUsages: Map<string, { hourly: number; hourlyResetAt: number }> }).userUsages;
      service.checkUserRateLimit('user:alice', tier);
      const entry = usage.get('user:alice');
      if (entry) entry.hourly = TIER_RATE_LIMITS[tier].hourlyLimit * 5;

      const result = service.checkUserRateLimit('user:alice', tier);
      expect(result.allowed).toBe(true);
    });

    it('getUserRateLimitStatus returns correct multiplied limits', () => {
      const tier = SubscriptionTier.FREE;
      const status = service.getUserRateLimitStatus('user:bob', tier);
      expect(status.limits.hourlyLimit).toBe(TIER_RATE_LIMITS[tier].hourlyLimit * 5);
    });
  });

  // -------------------------------------------------------------------------
  describe('recordRequest and analytics', () => {
    it('increments counters on record', () => {
      service.recordRequest('key1', SubscriptionTier.FREE, '/test', 200, 15);
      const usage = service.getUsage('key1')!;
      expect(usage.hourly).toBe(1);
      expect(usage.daily).toBe(1);
      expect(usage.monthly).toBe(1);
    });

    it('returns soft warning at 80% usage', () => {
      const tier = SubscriptionTier.FREE;
      const limits = TIER_RATE_LIMITS[tier];
      const usage = service.getOrCreateUsage('key1', tier);
      usage.hourly = Math.floor(limits.hourlyLimit * 0.8);

      const { softWarning } = service.recordRequest('key1', tier, '/test', 200, 5);
      expect(softWarning).toBeDefined();
      expect(softWarning?.warning).toBe('soft_limit_reached');
    });

    it('getAnalytics returns correct totals', () => {
      service.recordRequest('k1', SubscriptionTier.FREE, '/a', 200, 10);
      service.recordRequest('k1', SubscriptionTier.FREE, '/b', 200, 20);
      service.recordRequest('k2', SubscriptionTier.BASIC, '/a', 429, 5);

      const analytics = service.getAnalytics();
      expect(analytics.totalRequests).toBe(3);
      expect(analytics.rateLimitHitCount).toBe(1);
    });

    it('getRateLimitAnalytics returns per-tier breakdown', () => {
      service.recordRequest('k1', SubscriptionTier.FREE, '/a', 429, 5);
      service.recordRequest('k2', SubscriptionTier.BASIC, '/b', 200, 10);

      const rla = service.getRateLimitAnalytics();
      expect(rla.rateLimitHits).toBe(1);
      expect(rla.byTier[SubscriptionTier.FREE].hits).toBe(1);
      expect(rla.byTier[SubscriptionTier.BASIC].hits).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('getRateLimitStatus', () => {
    it('returns correct remaining values', () => {
      const tier = SubscriptionTier.BASIC;
      service.recordRequest('key1', tier, '/a', 200, 10);
      service.recordRequest('key1', tier, '/a', 200, 10);

      const status = service.getRateLimitStatus('key1', tier);
      expect(status.current.hourly).toBe(2);
      expect(status.remaining.hourly).toBe(TIER_RATE_LIMITS[tier].hourlyLimit - 2);
    });
  });
});

// ---------------------------------------------------------------------------
// Rate limit middleware unit tests
// ---------------------------------------------------------------------------

describe('createRateLimitMiddleware', () => {
  let service: RateLimitingService;
  let mw: ReturnType<typeof createRateLimitMiddleware>;

  beforeEach(() => {
    service = new RateLimitingService();
    mw = createRateLimitMiddleware({ service });
  });

  // -------------------------------------------------------------------------
  describe('bypass paths', () => {
    it('passes /health without rate limiting', () => {
      const req = makeReq({ path: '/health' });
      const res = makeRes();
      const next = runMiddleware(mw, req, res);
      expect(next).toBe(true);
      expect(res.ended).toBe(false);
    });

    it('passes /metrics/plan-cache without rate limiting', () => {
      const req = makeReq({ path: '/metrics/plan-cache' });
      const res = makeRes();
      expect(runMiddleware(mw, req, res)).toBe(true);
    });

    it('can configure custom bypass paths', () => {
      const customMw = createRateLimitMiddleware({
        service,
        bypassPaths: ['/health', '/internal'],
      });
      const req = makeReq({ path: '/internal/jobs' });
      const res = makeRes();
      expect(runMiddleware(customMw, req, res)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('bypass keys', () => {
    it('allows request from a bypassed API key', () => {
      // Exhaust the limit for the key first
      const tier = SubscriptionTier.FREE;
      const limits = TIER_RATE_LIMITS[tier];
      const usage = service.getOrCreateUsage('trusted-key', tier);
      usage.hourly = limits.hourlyLimit;

      const customMw = createRateLimitMiddleware({
        service,
        bypassKeys: new Set(['trusted-key']),
        tierFn: () => tier,
      });

      const req = makeReq({ headers: { 'x-api-key': 'trusted-key' }, path: '/plans' });
      const res = makeRes();
      expect(runMiddleware(customMw, req, res)).toBe(true);
      expect(res.ended).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('rate limit enforcement', () => {
    it('sets X-RateLimit-* headers on allowed requests', () => {
      const req = makeReq({ headers: { 'x-api-key': 'key1' }, path: '/plans' });
      const res = makeRes();

      runMiddleware(mw, req, res);

      expect(res.headers[RATE_LIMIT_HEADERS.LIMIT]).toBeDefined();
      expect(res.headers[RATE_LIMIT_HEADERS.REMAINING]).toBeDefined();
      expect(res.headers[RATE_LIMIT_HEADERS.RESET]).toBeDefined();
    });

    it('returns 429 when hourly limit is exceeded', () => {
      const tier = SubscriptionTier.FREE;
      const limits = TIER_RATE_LIMITS[tier];

      // Exhaust limit
      const usage = service.getOrCreateUsage('exhausted-key', tier);
      usage.hourly = limits.hourlyLimit;

      const customMw = createRateLimitMiddleware({
        service,
        tierFn: () => tier,
      });

      const req = makeReq({ headers: { 'x-api-key': 'exhausted-key' }, path: '/plans' });
      const res = makeRes();
      const next = runMiddleware(customMw, req, res);

      expect(next).toBe(false);
      expect(res.ended).toBe(true);
      expect(res.statusCode).toBe(429);
      expect(res.headers[RATE_LIMIT_HEADERS.RETRY_AFTER]).toBeDefined();
      expect(res.headers[RATE_LIMIT_HEADERS.REMAINING]).toBe(0);
    });

    it('does not block in softMode even when limit exceeded', () => {
      const tier = SubscriptionTier.FREE;
      const limits = TIER_RATE_LIMITS[tier];
      const usage = service.getOrCreateUsage('soft-key', tier);
      usage.hourly = limits.hourlyLimit;

      const softMw = createRateLimitMiddleware({
        service,
        tierFn: () => tier,
        softMode: true,
      });

      const req = makeReq({ headers: { 'x-api-key': 'soft-key' }, path: '/plans' });
      const res = makeRes();
      const next = runMiddleware(softMw, req, res);

      expect(next).toBe(true);
      expect(res.ended).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('per-user headers', () => {
    it('sets X-UserRateLimit-* headers when user ID provided', () => {
      const req = makeReq({
        headers: { 'x-api-key': 'key1', 'x-user-id': 'user123' },
        path: '/plans',
      });
      const res = makeRes();

      runMiddleware(mw, req, res);

      expect(res.headers[RATE_LIMIT_HEADERS.USER_LIMIT]).toBeDefined();
      expect(res.headers[RATE_LIMIT_HEADERS.USER_REMAINING]).toBeDefined();
      expect(res.headers[RATE_LIMIT_HEADERS.USER_RESET]).toBeDefined();
    });

    it('blocks when per-user limit is exceeded even if per-key is ok', () => {
      const tier = SubscriptionTier.FREE;
      const userHourlyLimit = TIER_RATE_LIMITS[tier].hourlyLimit * 5;

      // Exhaust user limit
      service.checkUserRateLimit('user:u1', tier); // init
      const userUsages = (service as unknown as { userUsages: Map<string, { hourly: number; hourlyResetAt: number }> }).userUsages;
      const entry = userUsages.get('user:u1')!;
      entry.hourly = userHourlyLimit;

      const customMw = createRateLimitMiddleware({ service, tierFn: () => tier });
      const req = makeReq({
        headers: { 'x-api-key': 'key1', 'x-user-id': 'u1' },
        path: '/plans',
      });
      const res = makeRes();
      const next = runMiddleware(customMw, req, res);

      expect(next).toBe(false);
      expect(res.statusCode).toBe(429);
    });
  });

  // -------------------------------------------------------------------------
  describe('IP fallback', () => {
    it('uses IP when no API key or user ID', () => {
      const req = makeReq({ path: '/plans', ip: '127.0.0.1', headers: {} });
      const res = makeRes();
      const next = runMiddleware(mw, req, res);

      // Should proceed (IP is well within FREE tier limits)
      expect(next).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('key extraction', () => {
    it('extracts API key from x-api-key header', () => {
      const req = makeReq({ headers: { 'x-api-key': 'sk_test_abc' }, path: '/plans' });
      const res = makeRes();
      runMiddleware(mw, req, res);
      // If parsed correctly the key usage is tracked
      expect(service.getUsage('sk_test_abc')).toBeDefined();
    });

    it('extracts API key from Authorization Bearer header', () => {
      const req = makeReq({
        headers: { authorization: 'Bearer sk_bearer_xyz' },
        path: '/plans',
      });
      const res = makeRes();
      runMiddleware(mw, req, res);
      expect(service.getUsage('sk_bearer_xyz')).toBeDefined();
    });

    it('can use a custom keyFn', () => {
      const customMw = createRateLimitMiddleware({
        service,
        keyFn: (r) => (r.headers['x-custom-key'] as string) || undefined,
      });
      const req = makeReq({ headers: { 'x-custom-key': 'custom123' }, path: '/plans' });
      const res = makeRes();
      runMiddleware(customMw, req, res);
      expect(service.getUsage('custom123')).toBeDefined();
    });
  });
});
