/**
 * Tests for CORS Policy Management with Dynamic Origin Whitelisting
 * Covers Issue #1000 — backend/services/shared/corsMiddleware.ts
 *
 * Run with:
 *   npx jest backend/services/shared/__tests__/corsMiddleware.test.ts --coverage
 */

import {
  upsertPolicy,
  getPolicy,
  getAllPolicies,
  deletePolicy,
  testOrigin,
  processCorsRequest,
  recordViolation,
  getCorsAnalytics,
  getViolations,
  clearPreflightCache,
  createCorsMiddleware,
  resetAnalytics,
  type CorsPolicy,
  type CorsViolation,
} from '../corsMiddleware';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let policyCounter = 0;

function makeTenantId(): string {
  return `tenant-${++policyCounter}-${Date.now()}`;
}

function makePolicy(
  tenantId: string,
  overrides: Partial<Omit<CorsPolicy, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>> = {},
): Omit<CorsPolicy, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'> {
  return {
    allowedOrigins: [{ origin: 'https://example.com', isWildcard: false }],
    allowCredentials: false,
    exposedHeaders: [],
    maxAge: 86400,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    active: true,
    ...overrides,
  };
}

interface MockRes {
  headers: Record<string, string | number | string[]>;
  statusCode: number;
  ended: boolean;
  setHeader(name: string, value: string | number | string[]): void;
}

function makeRes(): MockRes {
  const res: MockRes = {
    headers: {},
    statusCode: 200,
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetAnalytics();
  clearPreflightCache();
  // Remove all policies created in previous tests by cleaning via deletePolicy
  // We use getAllPolicies() which returns the live store snapshot
  for (const p of getAllPolicies()) {
    deletePolicy(p.tenantId);
  }
});

// ===========================================================================
// 1. Policy CRUD
// ===========================================================================

describe('upsertPolicy', () => {
  it('creates a new policy with an auto-generated id', () => {
    const tid = makeTenantId();
    const policy = upsertPolicy(tid, makePolicy(tid));

    expect(policy.id).toMatch(/^cors-/);
    expect(policy.tenantId).toBe(tid);
    expect(policy.active).toBe(true);
    expect(policy.createdAt).toBeDefined();
    expect(policy.updatedAt).toBeDefined();
  });

  it('updates an existing policy and preserves createdAt', async () => {
    const tid = makeTenantId();
    const first = upsertPolicy(tid, makePolicy(tid));
    // Ensure at least 1ms has passed so updatedAt differs
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = upsertPolicy(tid, makePolicy(tid, { maxAge: 3600 }));

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.maxAge).toBe(3600);
    // updatedAt should be the same or later than createdAt (not necessarily different)
    expect(new Date(second.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.createdAt).getTime(),
    );
  });

  it('stores the policy so it can be retrieved by getPolicy', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));
    expect(getPolicy(tid)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe('getPolicy', () => {
  it('returns undefined when no policy exists for a tenant', () => {
    expect(getPolicy('non-existent-tenant')).toBeUndefined();
  });

  it('returns undefined for an inactive policy', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid, { active: false }));
    expect(getPolicy(tid)).toBeUndefined();
  });

  it('returns the active policy', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));
    const policy = getPolicy(tid);
    expect(policy?.tenantId).toBe(tid);
  });
});

// ---------------------------------------------------------------------------

describe('getAllPolicies', () => {
  it('returns all policies including inactive ones', () => {
    const tid1 = makeTenantId();
    const tid2 = makeTenantId();
    upsertPolicy(tid1, makePolicy(tid1));
    upsertPolicy(tid2, makePolicy(tid2, { active: false }));

    const all = getAllPolicies();
    const tenants = all.map((p) => p.tenantId);
    expect(tenants).toContain(tid1);
    expect(tenants).toContain(tid2);
  });
});

// ---------------------------------------------------------------------------

describe('deletePolicy', () => {
  it('removes an existing policy and returns true', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));
    expect(deletePolicy(tid)).toBe(true);
    expect(getPolicy(tid)).toBeUndefined();
  });

  it('returns false when no policy exists for the tenant', () => {
    expect(deletePolicy('ghost-tenant')).toBe(false);
  });
});

// ===========================================================================
// 2. testOrigin
// ===========================================================================

describe('testOrigin', () => {
  it('returns allowed=false when no policy exists', () => {
    const result = testOrigin('https://unknown.com');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('allows an exactly matching origin', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));
    const result = testOrigin('https://example.com', tid);
    expect(result.allowed).toBe(true);
    expect(result.matchedPattern).toBe('https://example.com');
  });

  it('blocks an origin not in the whitelist', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));
    const result = testOrigin('https://evil.com', tid);
    expect(result.allowed).toBe(false);
    expect(result.policyId).toBeNull();
  });

  it('allows wildcard subdomain matching', () => {
    const tid = makeTenantId();
    upsertPolicy(
      tid,
      makePolicy(tid, {
        allowedOrigins: [{ origin: 'https://*.example.com', isWildcard: true }],
      }),
    );
    expect(testOrigin('https://api.example.com', tid).allowed).toBe(true);
    expect(testOrigin('https://app.example.com', tid).allowed).toBe(true);
    expect(testOrigin('https://evil.com', tid).allowed).toBe(false);
  });

  it('returns the matched policy id', () => {
    const tid = makeTenantId();
    const policy = upsertPolicy(tid, makePolicy(tid));
    const result = testOrigin('https://example.com', tid);
    expect(result.policyId).toBe(policy.id);
  });

  it('scopes the search to the specified tenantId', () => {
    const tid1 = makeTenantId();
    const tid2 = makeTenantId();
    upsertPolicy(tid1, makePolicy(tid1, { allowedOrigins: [{ origin: 'https://t1.com', isWildcard: false }] }));
    upsertPolicy(tid2, makePolicy(tid2, { allowedOrigins: [{ origin: 'https://t2.com', isWildcard: false }] }));

    expect(testOrigin('https://t1.com', tid1).allowed).toBe(true);
    expect(testOrigin('https://t1.com', tid2).allowed).toBe(false);
  });
});

// ===========================================================================
// 3. processCorsRequest
// ===========================================================================

describe('processCorsRequest — simple (non-OPTIONS) requests', () => {
  it('sets Access-Control-Allow-Origin for an allowed origin', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const { headers, allowed } = processCorsRequest({
      origin: 'https://example.com',
      method: 'GET',
      tenantId: tid,
    });

    expect(allowed).toBe(true);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com');
    expect(headers['Vary']).toBe('Origin');
  });

  it('does not set ACAO for a blocked origin', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const { headers, allowed } = processCorsRequest({
      origin: 'https://evil.com',
      method: 'GET',
      tenantId: tid,
    });

    expect(allowed).toBe(false);
    expect(headers['Access-Control-Allow-Origin']).toBeNull();
  });

  it('sets Allow-Credentials header when policy enables it', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid, { allowCredentials: true }));

    const { headers } = processCorsRequest({
      origin: 'https://example.com',
      method: 'GET',
      tenantId: tid,
    });

    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('does not set Allow-Credentials when disabled', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid, { allowCredentials: false }));

    const { headers } = processCorsRequest({
      origin: 'https://example.com',
      method: 'GET',
      tenantId: tid,
    });

    expect(headers['Access-Control-Allow-Credentials']).toBeNull();
  });

  it('sets Expose-Headers when policy specifies exposed headers', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid, { exposedHeaders: ['X-Custom', 'X-Another'] }));

    const { headers } = processCorsRequest({
      origin: 'https://example.com',
      method: 'GET',
      tenantId: tid,
    });

    expect(headers['Access-Control-Expose-Headers']).toBe('X-Custom, X-Another');
  });

  it('returns allowed=false when origin is undefined', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const { allowed } = processCorsRequest({ method: 'GET', tenantId: tid });
    expect(allowed).toBe(false);
  });

  it('increments totalRequests counter', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    processCorsRequest({ origin: 'https://example.com', method: 'GET', tenantId: tid });
    processCorsRequest({ origin: 'https://example.com', method: 'GET', tenantId: tid });

    const analytics = getCorsAnalytics();
    expect(analytics.totalRequests).toBeGreaterThanOrEqual(2);
  });

  it('increments allowedRequests counter on success', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    processCorsRequest({ origin: 'https://example.com', method: 'GET', tenantId: tid });

    const analytics = getCorsAnalytics();
    expect(analytics.allowedRequests).toBeGreaterThanOrEqual(1);
  });

  it('increments blockedRequests counter and records violation on failure', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    processCorsRequest({ origin: 'https://hacker.io', method: 'POST', tenantId: tid });

    const analytics = getCorsAnalytics();
    expect(analytics.blockedRequests).toBeGreaterThanOrEqual(1);
    const violations = getViolations({ tenantId: tid });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0]!.origin).toBe('https://hacker.io');
  });
});

// ---------------------------------------------------------------------------

describe('processCorsRequest — OPTIONS preflight', () => {
  it('sets preflight-specific headers for OPTIONS requests', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const { headers, allowed } = processCorsRequest({
      origin: 'https://example.com',
      method: 'OPTIONS',
      requestHeaders: 'Content-Type, Authorization',
      tenantId: tid,
    });

    expect(allowed).toBe(true);
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization');
    expect(headers['Access-Control-Max-Age']).toBe('86400');
  });

  it('caches preflight response for subsequent requests', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    // First call — cache miss
    processCorsRequest({ origin: 'https://example.com', method: 'OPTIONS', tenantId: tid });
    // Second call — cache hit
    processCorsRequest({ origin: 'https://example.com', method: 'OPTIONS', tenantId: tid });

    const analytics = getCorsAnalytics();
    expect(analytics.preflightCacheHitRate).toBeGreaterThan(0);
  });

  it('clearPreflightCache forces a cache miss on next preflight', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    processCorsRequest({ origin: 'https://example.com', method: 'OPTIONS', tenantId: tid });
    clearPreflightCache();
    processCorsRequest({ origin: 'https://example.com', method: 'OPTIONS', tenantId: tid });

    // After clearing, the second call is a miss → hit rate should be 0 (0 hits / 2 total)
    const analytics = getCorsAnalytics();
    // hit rate = 0 / 2 = 0
    expect(analytics.preflightCacheHitRate).toBe(0);
  });
});

// ===========================================================================
// 4. recordViolation
// ===========================================================================

describe('recordViolation', () => {
  it('stores a violation that can be retrieved via getViolations', () => {
    const violation: CorsViolation = {
      requestId: 'req-001',
      origin: 'https://bad-actor.net',
      method: 'DELETE',
      requestedHeaders: ['X-Evil'],
      tenantId: 'tenant-x',
      timestamp: new Date().toISOString(),
      path: '/plans',
      userAgent: 'curl/7.x',
      ip: '1.2.3.4',
    };

    recordViolation(violation);

    const violations = getViolations({ tenantId: 'tenant-x' });
    expect(violations).toHaveLength(1);
    expect(violations[0]!.requestId).toBe('req-001');
  });
});

// ===========================================================================
// 5. getCorsAnalytics
// ===========================================================================

describe('getCorsAnalytics', () => {
  it('returns zeroed counters after resetAnalytics', () => {
    const analytics = getCorsAnalytics();
    expect(analytics.totalRequests).toBe(0);
    expect(analytics.allowedRequests).toBe(0);
    expect(analytics.blockedRequests).toBe(0);
    expect(analytics.uniqueOrigins).toBe(0);
    expect(analytics.preflightCacheHitRate).toBe(0);
  });

  it('tracks requestsByMethod', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    processCorsRequest({ origin: 'https://example.com', method: 'GET', tenantId: tid });
    processCorsRequest({ origin: 'https://example.com', method: 'POST', tenantId: tid });

    const analytics = getCorsAnalytics();
    expect(analytics.requestsByMethod['GET']).toBeGreaterThanOrEqual(1);
    expect(analytics.requestsByMethod['POST']).toBeGreaterThanOrEqual(1);
  });

  it('tracks violationsByOrigin', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    processCorsRequest({ origin: 'https://bad.com', method: 'GET', tenantId: tid });
    processCorsRequest({ origin: 'https://bad.com', method: 'POST', tenantId: tid });

    const analytics = getCorsAnalytics();
    expect(analytics.violationsByOrigin['https://bad.com']).toBeGreaterThanOrEqual(2);
  });

  it('tracks violationsByTenant', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    processCorsRequest({ origin: 'https://bad.com', method: 'GET', tenantId: tid });

    const analytics = getCorsAnalytics();
    expect(analytics.violationsByTenant[tid]).toBeGreaterThanOrEqual(1);
  });

  it('includes a timestamp', () => {
    const analytics = getCorsAnalytics();
    expect(new Date(analytics.timestamp).getTime()).not.toBeNaN();
  });
});

// ===========================================================================
// 6. getViolations filtering
// ===========================================================================

describe('getViolations', () => {
  it('filters by tenantId', () => {
    const tid1 = makeTenantId();
    const tid2 = makeTenantId();
    upsertPolicy(tid1, makePolicy(tid1));
    upsertPolicy(tid2, makePolicy(tid2));

    processCorsRequest({ origin: 'https://x.com', method: 'GET', tenantId: tid1 });
    processCorsRequest({ origin: 'https://y.com', method: 'GET', tenantId: tid2 });

    const v1 = getViolations({ tenantId: tid1 });
    const v2 = getViolations({ tenantId: tid2 });

    expect(v1.every((v) => v.tenantId === tid1)).toBe(true);
    expect(v2.every((v) => v.tenantId === tid2)).toBe(true);
  });

  it('filters by origin', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    processCorsRequest({ origin: 'https://alpha.io', method: 'GET', tenantId: tid });
    processCorsRequest({ origin: 'https://beta.io', method: 'GET', tenantId: tid });

    const forAlpha = getViolations({ origin: 'https://alpha.io' });
    expect(forAlpha.every((v) => v.origin === 'https://alpha.io')).toBe(true);
  });

  it('respects the limit option', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    for (let i = 0; i < 10; i++) {
      processCorsRequest({ origin: `https://bad-${i}.com`, method: 'GET', tenantId: tid });
    }

    const limited = getViolations({ limit: 3 });
    expect(limited.length).toBeLessThanOrEqual(3);
  });

  it('filters by since timestamp', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const oldViolation: CorsViolation = {
      requestId: 'old',
      origin: 'https://old.com',
      method: 'GET',
      requestedHeaders: [],
      tenantId: tid,
      timestamp: '2020-01-01T00:00:00.000Z',
      path: '/',
      userAgent: '',
      ip: '',
    };
    recordViolation(oldViolation);

    const newViolation: CorsViolation = {
      requestId: 'new',
      origin: 'https://new.com',
      method: 'GET',
      requestedHeaders: [],
      tenantId: tid,
      timestamp: new Date().toISOString(),
      path: '/',
      userAgent: '',
      ip: '',
    };
    recordViolation(newViolation);

    const recent = getViolations({ tenantId: tid, since: '2025-01-01T00:00:00.000Z' });
    expect(recent.every((v) => v.timestamp >= '2025-01-01T00:00:00.000Z')).toBe(true);
  });
});

// ===========================================================================
// 7. createCorsMiddleware (Express-style)
// ===========================================================================

describe('createCorsMiddleware', () => {
  it('calls next() for an allowed origin', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const mw = createCorsMiddleware(tid);
    const res = makeRes();
    let called = false;

    mw(
      { headers: { origin: 'https://example.com' }, method: 'GET' },
      res,
      () => { called = true; },
    );

    expect(called).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://example.com');
  });

  it('calls next() even for a blocked origin (does not block at middleware level)', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const mw = createCorsMiddleware(tid);
    const res = makeRes();
    let called = false;

    mw(
      { headers: { origin: 'https://bad-actor.net' }, method: 'GET' },
      res,
      () => { called = true; },
    );

    // CORS middleware passes control to next; blocking is at the application layer
    expect(called).toBe(true);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('handles OPTIONS preflight without calling next', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const mw = createCorsMiddleware(tid);
    const res = makeRes();
    let called = false;

    mw(
      { headers: { origin: 'https://example.com' }, method: 'OPTIONS' },
      res,
      () => { called = true; },
    );

    expect(called).toBe(false);
    expect(res.headers['Access-Control-Allow-Methods']).toBeDefined();
  });

  it('uses req.tenantId when available, overriding the default', () => {
    const defaultTid = makeTenantId();
    const reqTid = makeTenantId();

    upsertPolicy(defaultTid, makePolicy(defaultTid, {
      allowedOrigins: [{ origin: 'https://default.com', isWildcard: false }],
    }));
    upsertPolicy(reqTid, makePolicy(reqTid, {
      allowedOrigins: [{ origin: 'https://per-request.com', isWildcard: false }],
    }));

    const mw = createCorsMiddleware(defaultTid);
    const res = makeRes();

    mw(
      { headers: { origin: 'https://per-request.com' }, method: 'GET', tenantId: reqTid },
      res,
      () => {},
    );

    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://per-request.com');
  });

  it('reads access-control-request-headers for preflights', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const mw = createCorsMiddleware(tid);
    const res = makeRes();

    mw(
      {
        headers: {
          origin: 'https://example.com',
          'access-control-request-headers': 'Content-Type, X-Custom',
        },
        method: 'OPTIONS',
      },
      res,
      () => {},
    );

    expect(res.headers['Access-Control-Allow-Headers']).toBeDefined();
  });
});

// ===========================================================================
// 8. resetAnalytics
// ===========================================================================

describe('resetAnalytics', () => {
  it('resets all counters to zero', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    processCorsRequest({ origin: 'https://example.com', method: 'GET', tenantId: tid });
    processCorsRequest({ origin: 'https://bad.com', method: 'GET', tenantId: tid });

    resetAnalytics();

    const analytics = getCorsAnalytics();
    expect(analytics.totalRequests).toBe(0);
    expect(analytics.allowedRequests).toBe(0);
    expect(analytics.blockedRequests).toBe(0);
    expect(analytics.preflightCacheHitRate).toBe(0);
    expect(Object.keys(analytics.requestsByMethod)).toHaveLength(0);
    expect(analytics.uniqueOrigins).toBe(0);
  });
});

// ===========================================================================
// 9. Integration: full request lifecycle
// ===========================================================================

describe('Integration: full CORS request lifecycle', () => {
  it('allows a browser cross-origin flow: preflight then real request', () => {
    const tid = makeTenantId();
    upsertPolicy(
      tid,
      makePolicy(tid, {
        allowedOrigins: [{ origin: 'https://app.example.com', isWildcard: false }],
        allowCredentials: true,
        exposedHeaders: ['X-Token'],
      }),
    );

    // --- Preflight (OPTIONS) ---
    const preflight = processCorsRequest({
      origin: 'https://app.example.com',
      method: 'OPTIONS',
      requestHeaders: 'Content-Type, Authorization',
      tenantId: tid,
    });

    expect(preflight.allowed).toBe(true);
    expect(preflight.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(preflight.headers['Access-Control-Allow-Methods']).toBe('GET, POST, OPTIONS');
    expect(preflight.headers['Access-Control-Max-Age']).toBe('86400');
    expect(preflight.headers['Access-Control-Allow-Credentials']).toBe('true');

    // --- Actual request (POST) ---
    const request = processCorsRequest({
      origin: 'https://app.example.com',
      method: 'POST',
      tenantId: tid,
    });

    expect(request.allowed).toBe(true);
    expect(request.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(request.headers['Access-Control-Expose-Headers']).toBe('X-Token');
  });

  it('blocks a cross-origin request from an unlisted origin and records a violation', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const result = processCorsRequest({
      origin: 'https://attacker.xyz',
      method: 'POST',
      tenantId: tid,
    });

    expect(result.allowed).toBe(false);
    expect(result.headers['Access-Control-Allow-Origin']).toBeNull();

    const violations = getViolations({ tenantId: tid, origin: 'https://attacker.xyz' });
    expect(violations.length).toBeGreaterThanOrEqual(1);

    const analytics = getCorsAnalytics();
    expect(analytics.blockedRequests).toBeGreaterThanOrEqual(1);
    expect(analytics.violationsByOrigin['https://attacker.xyz']).toBeGreaterThanOrEqual(1);
  });

  it('wildcard policy allows any subdomain', () => {
    const tid = makeTenantId();
    upsertPolicy(
      tid,
      makePolicy(tid, {
        allowedOrigins: [{ origin: 'https://*.myapp.io', isWildcard: true }],
      }),
    );

    const subdomains = ['https://api.myapp.io', 'https://dashboard.myapp.io', 'https://admin.myapp.io'];
    for (const origin of subdomains) {
      const result = processCorsRequest({ origin, method: 'GET', tenantId: tid });
      expect(result.allowed).toBe(true);
    }

    const blocked = processCorsRequest({ origin: 'https://evil.myapp.io.com', method: 'GET', tenantId: tid });
    expect(blocked.allowed).toBe(false);
  });

  it('preflight caching returns a cached response on the second call', () => {
    const tid = makeTenantId();
    upsertPolicy(tid, makePolicy(tid));

    const first = processCorsRequest({
      origin: 'https://example.com',
      method: 'OPTIONS',
      tenantId: tid,
    });

    const second = processCorsRequest({
      origin: 'https://example.com',
      method: 'OPTIONS',
      tenantId: tid,
    });

    // Both should be allowed and return identical headers from cache
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.headers['Access-Control-Allow-Origin']).toBe('https://example.com');

    const analytics = getCorsAnalytics();
    // 1 miss + 1 hit → hit rate = 0.5
    expect(analytics.preflightCacheHitRate).toBe(0.5);
  });
});
