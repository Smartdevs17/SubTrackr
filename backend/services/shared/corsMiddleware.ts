/**
 * Issue #772 – CORS Policy Management with Dynamic Origin Whitelisting
 *
 * Provides:
 *   - Dynamic CORS origin configuration
 *   - Per-tenant whitelisting
 *   - Preflight request caching
 *   - CORS violation logging
 *   - CORS analytics
 *   - Origin validation with wildcards
 *   - CORS policy testing
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface CorsOrigin {
  /** Origin URL or pattern (supports wildcards like *.example.com) */
  origin: string;
  /** Whether this is a wildcard pattern */
  isWildcard: boolean;
}

export interface CorsPolicy {
  /** Unique policy identifier */
  id: string;
  /** Tenant this policy belongs to */
  tenantId: string;
  /** Allowed origins */
  allowedOrigins: CorsOrigin[];
  /** Whether to include Access-Control-Allow-Credentials */
  allowCredentials: boolean;
  /** Headers to expose to the browser */
  exposedHeaders: string[];
  /** Max age in seconds for preflight cache */
  maxAge: number;
  /** Allowed HTTP methods */
  allowMethods: string[];
  /** Allowed request headers */
  allowHeaders: string[];
  /** Whether this policy is active */
  active: boolean;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
}

export interface CorsViolation {
  /** Request ID */
  requestId: string;
  /** Origin that was blocked */
  origin: string;
  /** Requested method */
  method: string;
  /** Requested headers */
  requestedHeaders: string[];
  /** Tenant ID */
  tenantId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Request path */
  path: string;
  /** User agent */
  userAgent: string;
  /** IP address */
  ip: string;
}

export interface CorsAnalytics {
  /** Total requests processed */
  totalRequests: number;
  /** Successful CORS requests */
  allowedRequests: number;
  /** Blocked CORS requests (violations) */
  blockedRequests: number;
  /** Number of unique origins seen */
  uniqueOrigins: number;
  /** Violations by origin */
  violationsByOrigin: Record<string, number>;
  /** Violations by tenant */
  violationsByTenant: Record<string, number>;
  /** Requests by method */
  requestsByMethod: Record<string, number>;
  /** Preflight cache hit rate */
  preflightCacheHitRate: number;
  /** Timestamp of analytics snapshot */
  timestamp: string;
}

export interface CorsTestResult {
  /** Whether the origin would be allowed */
  allowed: boolean;
  /** Matched policy */
  policyId: string | null;
  /** Matched origin pattern */
  matchedPattern: string | null;
  /** Reason for denial if blocked */
  reason: string | null;
}

// ── Policy Store (in-memory; replace with DB in production) ──────────────────

const policies = new Map<string, CorsPolicy>();
const violations: CorsViolation[] = [];
const preflightCache = new Map<string, { response: CorsHeadersResult; expiresAt: number }>();

// Analytics counters
let totalRequests = 0;
let allowedRequests = 0;
let blockedRequests = 0;
let preflightCacheHits = 0;
let preflightCacheMisses = 0;
const requestsByMethod: Record<string, number> = {};

// ── Wildcard Matching ────────────────────────────────────────────────────────

function matchWildcard(origin: string, pattern: string): boolean {
  if (!pattern.includes('*')) {
    return origin === pattern;
  }

  // Convert wildcard pattern to regex
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${regexStr}$`, 'i');
  return regex.test(origin);
}

function parseOrigin(originStr: string): CorsOrigin {
  const isWildcard = originStr.includes('*');
  return { origin: originStr, isWildcard };
}

// ── Core CORS Logic ──────────────────────────────────────────────────────────

function findPolicyForRequest(
  origin: string | undefined,
  tenantId?: string
): CorsPolicy | undefined {
  if (!origin) return undefined;

  for (const policy of policies.values()) {
    if (!policy.active) continue;
    if (tenantId && policy.tenantId !== tenantId) continue;

    for (const allowed of policy.allowedOrigins) {
      if (matchWildcard(origin, allowed.origin)) {
        return policy;
      }
    }
  }

  return undefined;
}

export interface CorsHeadersResult {
  'Access-Control-Allow-Origin': string | null;
  'Access-Control-Allow-Methods': string | null;
  'Access-Control-Allow-Headers': string | null;
  'Access-Control-Allow-Credentials': string | null;
  'Access-Control-Expose-Headers': string | null;
  'Access-Control-Max-Age': string | null;
  'Vary': string | null;
}

function buildCorsHeaders(
  origin: string | undefined,
  method: string | undefined,
  requestHeaders: string | undefined,
  policy: CorsPolicy | undefined
): CorsHeadersResult {
  const headers: CorsHeadersResult = {
    'Access-Control-Allow-Origin': null,
    'Access-Control-Allow-Methods': null,
    'Access-Control-Allow-Headers': null,
    'Access-Control-Allow-Credentials': null,
    'Access-Control-Expose-Headers': null,
    'Access-Control-Max-Age': null,
    'Vary': null,
  };

  if (!policy || !origin) return headers;

  headers['Access-Control-Allow-Origin'] = origin;
  headers['Vary'] = 'Origin';

  if (policy.allowCredentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  if (policy.exposedHeaders.length > 0) {
    headers['Access-Control-Expose-Headers'] = policy.exposedHeaders.join(', ');
  }

  if (method === 'OPTIONS') {
    // Preflight response
    headers['Access-Control-Allow-Methods'] = policy.allowMethods.join(', ');
    headers['Access-Control-Allow-Headers'] = policy.allowHeaders.join(', ');
    headers['Access-Control-Max-Age'] = String(policy.maxAge);
  }

  return headers;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create or update a CORS policy for a tenant.
 */
export function upsertPolicy(
  tenantId: string,
  config: Omit<CorsPolicy, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
): CorsPolicy {
  const existing = Array.from(policies.values()).find((p) => p.tenantId === tenantId);

  const now = new Date().toISOString();
  const policy: CorsPolicy = {
    id: existing?.id ?? `cors-${tenantId}-${Date.now()}`,
    tenantId,
    ...config,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  policies.set(policy.id, policy);
  return policy;
}

/**
 * Get the CORS policy for a tenant.
 */
export function getPolicy(tenantId: string): CorsPolicy | undefined {
  return Array.from(policies.values()).find((p) => p.tenantId === tenantId && p.active);
}

/**
 * Get all CORS policies.
 */
export function getAllPolicies(): CorsPolicy[] {
  return Array.from(policies.values());
}

/**
 * Delete a CORS policy.
 */
export function deletePolicy(tenantId: string): boolean {
  const policy = Array.from(policies.values()).find((p) => p.tenantId === tenantId);
  if (!policy) return false;
  policies.delete(policy.id);
  return true;
}

/**
 * Test whether an origin would be allowed for a tenant.
 */
export function testOrigin(origin: string, tenantId?: string): CorsTestResult {
  const policy = findPolicyForRequest(origin, tenantId);

  if (!policy) {
    return {
      allowed: false,
      policyId: null,
      matchedPattern: null,
      reason: 'No matching CORS policy found',
    };
  }

  const matched = policy.allowedOrigins.find((o) => matchWildcard(origin, o.origin));

  return {
    allowed: true,
    policyId: policy.id,
    matchedPattern: matched?.origin ?? null,
    reason: null,
  };
}

/**
 * Process a CORS request and return the appropriate headers.
 * Handles both preflight (OPTIONS) and simple requests.
 */
export function processCorsRequest(options: {
  origin?: string;
  method?: string;
  requestHeaders?: string;
  tenantId?: string;
}): { headers: CorsHeadersResult; allowed: boolean } {
  const { origin, method, requestHeaders, tenantId } = options;

  totalRequests++;
  requestsByMethod[method ?? 'UNKNOWN'] = (requestsByMethod[method ?? 'UNKNOWN'] ?? 0) + 1;

  // Check preflight cache
  if (method === 'OPTIONS' && origin) {
    const cacheKey = `${origin}:${tenantId ?? 'default'}`;
    const cached = preflightCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      preflightCacheHits++;
      return { headers: cached.response, allowed: true };
    }
    preflightCacheMisses++;
  }

  const policy = findPolicyForRequest(origin, tenantId);
  const headers = buildCorsHeaders(origin, method, requestHeaders, policy);

  const allowed = headers['Access-Control-Allow-Origin'] !== null;

  if (allowed) {
    allowedRequests++;
  } else if (origin) {
    blockedRequests++;
    recordViolation({
      requestId: `req-${Date.now()}`,
      origin,
      method: method ?? 'UNKNOWN',
      requestedHeaders: requestHeaders ? requestHeaders.split(',').map((h) => h.trim()) : [],
      tenantId: tenantId ?? 'unknown',
      timestamp: new Date().toISOString(),
      path: '/',
      userAgent: '',
      ip: '',
    });
  }

  // Cache preflight response
  if (method === 'OPTIONS' && policy) {
    const cacheKey = `${origin}:${tenantId ?? 'default'}`;
    preflightCache.set(cacheKey, {
      response: headers,
      expiresAt: Date.now() + policy.maxAge * 1000,
    });
  }

  return { headers, allowed };
}

/**
 * Record a CORS violation for analytics.
 */
export function recordViolation(violation: CorsViolation): void {
  violations.push(violation);

  // Keep last 10000 violations
  if (violations.length > 10000) {
    violations.splice(0, violations.length - 10000);
  }
}

/**
 * Get CORS analytics snapshot.
 */
export function getCorsAnalytics(): CorsAnalytics {
  const violationsByOrigin: Record<string, number> = {};
  const violationsByTenant: Record<string, number> = {};
  const uniqueOrigins = new Set<string>();

  for (const v of violations) {
    violationsByOrigin[v.origin] = (violationsByOrigin[v.origin] ?? 0) + 1;
    violationsByTenant[v.tenantId] = (violationsByTenant[v.tenantId] ?? 0) + 1;
    uniqueOrigins.add(v.origin);
  }

  const totalPreflight = preflightCacheHits + preflightCacheMisses;

  return {
    totalRequests,
    allowedRequests,
    blockedRequests,
    uniqueOrigins: uniqueOrigins.size,
    violationsByOrigin,
    violationsByTenant,
    requestsByMethod,
    preflightCacheHitRate: totalPreflight > 0 ? preflightCacheHits / totalPreflight : 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get recent violations, optionally filtered.
 */
export function getViolations(options: {
  tenantId?: string;
  origin?: string;
  limit?: number;
  since?: string;
} = {}): CorsViolation[] {
  const { tenantId, origin, limit = 100, since } = options;
  let filtered = violations;

  if (tenantId) filtered = filtered.filter((v) => v.tenantId === tenantId);
  if (origin) filtered = filtered.filter((v) => v.origin === origin);
  if (since) filtered = filtered.filter((v) => v.timestamp >= since);

  return filtered.slice(-limit);
}

/**
 * Clear the preflight cache.
 */
export function clearPreflightCache(): void {
  preflightCache.clear();
}

/**
 * Express/Connect-style CORS middleware factory.
 */
export function createCorsMiddleware(defaultTenantId?: string) {
  return function corsMiddleware(
    req: {
      headers?: Record<string, string | string[] | undefined>;
      method?: string;
      url?: string;
      tenantId?: string;
    },
    res: {
      setHeader(name: string, value: string | number | string[]): void;
    },
    next: () => void
  ): void {
    const origin = typeof req.headers?.['origin'] === 'string'
      ? req.headers['origin']
      : undefined;
    const method = req.method;
    const requestHeaders = typeof req.headers?.['access-control-request-headers'] === 'string'
      ? req.headers['access-control-request-headers']
      : undefined;
    const tenantId = req.tenantId ?? defaultTenantId;

    const { headers, allowed } = processCorsRequest({
      origin,
      method,
      requestHeaders,
      tenantId,
    });

    // Apply CORS headers
    for (const [name, value] of Object.entries(headers)) {
      if (value !== null) {
        res.setHeader(name, value);
      }
    }

    // Handle preflight
    if (method === 'OPTIONS' && allowed) {
      res.setHeader('Content-Length', '0');
      return;
    }

    next();
  };
}

/**
 * Reset analytics counters (for testing).
 */
export function resetAnalytics(): void {
  totalRequests = 0;
  allowedRequests = 0;
  blockedRequests = 0;
  preflightCacheHits = 0;
  preflightCacheMisses = 0;
  Object.keys(requestsByMethod).forEach((k) => delete requestsByMethod[k]);
  violations.length = 0;
}
