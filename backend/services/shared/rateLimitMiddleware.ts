/**
 * Rate Limit Middleware — SubTrackr
 *
 * Issue #913: Implement rate limiting per user and per API key
 *
 * Express / Fastify-compatible middleware that integrates RateLimitingService
 * (token bucket + sliding-window counters) with standard HTTP headers.
 *
 * Usage (Express):
 *   app.use(createRateLimitMiddleware({ service: rateLimitingService }));
 *
 * Usage (Fastify):
 *   fastify.addHook('preHandler', createFastifyRateLimitHook({ service: rateLimitingService }));
 */

import { RateLimitingService } from './rateLimitingService';
import { SubscriptionTier } from '../../src/types/subscription';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RateLimitMiddlewareOptions {
  service: RateLimitingService;
  /**
   * Extract the API key from the request.
   * Default: Authorization header (Bearer token) or X-Api-Key header.
   */
  getApiKey?: (req: MinimalRequest) => string | undefined;
  /**
   * Extract the subscription tier for the key.
   * Default: always FREE (override to integrate with your auth layer).
   */
  getTier?: (apiKey: string, req: MinimalRequest) => SubscriptionTier | Promise<SubscriptionTier>;
  /**
   * Extract a user ID for per-user aggregate limiting.
   * Return undefined to skip per-user limiting.
   */
  getUserId?: (req: MinimalRequest) => string | undefined;
  /**
   * If true, requests with missing or invalid API keys still pass through
   * (useful in development). Default: false.
   */
  allowMissingKey?: boolean;
  /**
   * Custom response body for 429 responses.
   * Default: { error: 'rate_limit_exceeded', retryAfterMs, message }
   */
  rateLimitExceededBody?: (retryAfterMs: number) => Record<string, unknown>;
  /**
   * Skip rate limiting entirely for these path prefixes.
   * Merged with service.bypass.paths.
   */
  skipPaths?: string[];
}

/** Minimal interface satisfied by both Express.Request and Fastify.Request */
export interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>;
  path?: string;
  url?: string;
  method?: string;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/** Minimal interface satisfied by both Express.Response and Fastify.Reply */
export interface MinimalResponse {
  status(code: number): MinimalResponse;
  set?(header: string, value: string): MinimalResponse;
  header?(header: string, value: string): MinimalResponse;
  json(body: unknown): void;
}

export type NextFn = (err?: unknown) => void;

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

function setHeader(res: MinimalResponse, name: string, value: string): void {
  if (typeof res.set === 'function') {
    res.set(name, value);
  } else if (typeof res.header === 'function') {
    res.header(name, value);
  }
}

function defaultGetApiKey(req: MinimalRequest): string | undefined {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const xKey = req.headers['x-api-key'];
  return typeof xKey === 'string' ? xKey.trim() : undefined;
}

function getPath(req: MinimalRequest): string {
  return req.path ?? (req.url ? req.url.split('?')[0]! : '/');
}

// ---------------------------------------------------------------------------
// Express middleware factory
// ---------------------------------------------------------------------------

export function createRateLimitMiddleware(opts: RateLimitMiddlewareOptions) {
  const {
    service,
    getApiKey = defaultGetApiKey,
    getTier = () => SubscriptionTier.FREE,
    getUserId,
    allowMissingKey = false,
    rateLimitExceededBody,
    skipPaths = [],
  } = opts;

  const allSkipPaths = [
    ...(service.bypass.paths ?? []),
    ...skipPaths,
  ];

  return async function rateLimitMiddleware(
    req: MinimalRequest,
    res: MinimalResponse,
    next: NextFn,
  ): Promise<void> {
    const path = getPath(req);

    // Skip configured paths
    if (allSkipPaths.some((p) => path.startsWith(p))) {
      next();
      return;
    }

    const apiKey = getApiKey(req);

    if (!apiKey) {
      if (allowMissingKey) {
        next();
        return;
      }
      res.status(401).json({ error: 'missing_api_key', message: 'API key required' });
      return;
    }

    const tier = await getTier(apiKey, req);
    const start = Date.now();

    // Per-key check
    const keyCheck = service.checkRateLimit(apiKey, tier);

    if (!keyCheck.allowed) {
      const retryAfterMs = keyCheck.retryAfterMs ?? 1_000;
      const retryAfterSec = Math.ceil(retryAfterMs / 1_000);

      setHeader(res, 'Retry-After', String(retryAfterSec));
      setHeader(res, 'X-RateLimit-Retry-After-Ms', String(retryAfterMs));

      const body = rateLimitExceededBody
        ? rateLimitExceededBody(retryAfterMs)
        : {
            error: 'rate_limit_exceeded',
            message: `Rate limit exceeded. Retry after ${retryAfterSec}s.`,
            retryAfterMs,
            retryAfterSec,
          };

      res.status(429).json(body);
      return;
    }

    // Per-user aggregate check
    if (getUserId) {
      const userId = getUserId(req);
      if (userId) {
        const userCheck = service.checkUserRateLimit(`user:${userId}`, tier);
        if (!userCheck.allowed) {
          const retryAfterMs = userCheck.retryAfterMs ?? 1_000;
          const retryAfterSec = Math.ceil(retryAfterMs / 1_000);

          setHeader(res, 'Retry-After', String(retryAfterSec));
          setHeader(res, 'X-RateLimit-Retry-After-Ms', String(retryAfterMs));

          res.status(429).json(
            rateLimitExceededBody
              ? rateLimitExceededBody(retryAfterMs)
              : {
                  error: 'user_rate_limit_exceeded',
                  message: `User-level rate limit exceeded. Retry after ${retryAfterSec}s.`,
                  retryAfterMs,
                },
          );
          return;
        }
      }
    }

    // Attach current status headers
    const status = service.getRateLimitStatus(apiKey, tier);
    setHeader(res, 'X-RateLimit-Limit', String(status.limits.hourlyLimit));
    setHeader(res, 'X-RateLimit-Remaining', String(status.remaining.hourly));
    setHeader(res, 'X-RateLimit-Reset', String(Math.ceil(status.resetAt.hourly / 1_000)));
    setHeader(res, 'X-RateLimit-Burst-Remaining', String(status.remaining.burstTokens));

    // Warn if approaching soft limit
    const pct = status.current.hourly / status.limits.hourlyLimit;
    if (pct >= 0.8) {
      setHeader(res, 'X-RateLimit-Warning', `Usage at ${Math.round(pct * 100)}% of hourly limit`);
    }

    // Deprecation header for grace-period API keys (integrates with #1009)
    const graceHeader = req.headers['x-grace-period-key'];
    if (graceHeader === 'true') {
      setHeader(res, 'Deprecation', 'true');
      setHeader(res, 'Sunset', req.headers['x-grace-expires'] as string ?? '');
    }

    // Record usage asynchronously so it does not block the response
    const originalJson = res.json.bind(res);
    let statusCode = 200;

    res.status = (code: number) => {
      statusCode = code;
      return res;
    };

    res.json = (body: unknown) => {
      // Record after response is built
      const latencyMs = Date.now() - start;
      service.recordRequest(apiKey, tier, path, statusCode, latencyMs);

      if (getUserId) {
        const userId = getUserId(req);
        if (userId) {
          service.recordUserRequest(`user:${userId}`, tier, path);
        }
      }

      originalJson(body);
    };

    next();
  };
}

// ---------------------------------------------------------------------------
// Fastify hook factory (thin wrapper using the same logic)
// ---------------------------------------------------------------------------

export function createFastifyRateLimitHook(opts: RateLimitMiddlewareOptions) {
  const handler = createRateLimitMiddleware(opts);

  return async function fastifyPreHandler(
    request: MinimalRequest & { raw?: MinimalRequest },
    reply: MinimalResponse,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      handler(request, reply, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };
}

// ---------------------------------------------------------------------------
// IP-based fallback middleware (for unauthenticated endpoints)
// ---------------------------------------------------------------------------

export function createIpRateLimitMiddleware(opts: Omit<RateLimitMiddlewareOptions, 'getApiKey'>) {
  return createRateLimitMiddleware({
    ...opts,
    allowMissingKey: true,
    getApiKey: (req) => {
      const ip =
        req.ip ??
        (req.socket?.remoteAddress) ??
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
        'unknown';
      return `ip:${ip}`;
    },
  });
}

// ---------------------------------------------------------------------------
// Named header constants (issue #913)
// ---------------------------------------------------------------------------

export const RATE_LIMIT_HEADERS = {
  LIMIT: 'X-RateLimit-Limit',
  REMAINING: 'X-RateLimit-Remaining',
  RESET: 'X-RateLimit-Reset',
  BURST_REMAINING: 'X-RateLimit-Burst-Remaining',
  WARNING: 'X-RateLimit-Warning',
  RETRY_AFTER: 'Retry-After',
  RETRY_AFTER_MS: 'X-RateLimit-Retry-After-Ms',
} as const;

// ---------------------------------------------------------------------------
// Request / Response type aliases (issue #913)
// ---------------------------------------------------------------------------

/** Alias for MinimalRequest — for consumers that prefer the typed name. */
export type RateLimitRequest = MinimalRequest;

/** Alias for MinimalResponse — for consumers that prefer the typed name. */
export type RateLimitResponse = MinimalResponse;

// ---------------------------------------------------------------------------
// Status-only middleware (read-only — attaches headers without blocking)
// ---------------------------------------------------------------------------

/**
 * Attach X-RateLimit-* headers without enforcing limits.
 * Useful on endpoints that only need observability, not enforcement.
 */
export function createRateLimitStatusMiddleware(
  opts: Pick<RateLimitMiddlewareOptions, 'service' | 'getApiKey' | 'getTier'>,
) {
  const {
    service,
    getApiKey = (req) => {
      const auth = req.headers['authorization'];
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
      const xKey = req.headers['x-api-key'];
      return typeof xKey === 'string' ? xKey.trim() : undefined;
    },
    getTier = () => SubscriptionTier.FREE,
  } = opts;

  return async function rateLimitStatusMiddleware(
    req: MinimalRequest,
    res: MinimalResponse,
    next: NextFn,
  ): Promise<void> {
    const apiKey = getApiKey(req);
    if (apiKey) {
      const tier = await getTier(apiKey, req);
      const status = service.getRateLimitStatus(apiKey, tier);
      setHeader(res, RATE_LIMIT_HEADERS.LIMIT, String(status.limits.hourlyLimit));
      setHeader(res, RATE_LIMIT_HEADERS.REMAINING, String(status.remaining.hourly));
      setHeader(res, RATE_LIMIT_HEADERS.RESET, String(Math.ceil(status.resetAt.hourly / 1_000)));
      setHeader(res, RATE_LIMIT_HEADERS.BURST_REMAINING, String(status.remaining.burstTokens));
    }
    next();
  };
}
