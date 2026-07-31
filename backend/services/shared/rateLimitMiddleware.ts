/**
 * Rate limiting middleware for SubTrackr API.
 *
 * Supports:
 *   - Token-bucket burst limiting with continuous refill
 *   - Per-API-key rate limiting (hourly / daily / monthly / concurrent)
 *   - Per-user rate limiting (aggregate across all keys for a user)
 *   - Standard rate-limit response headers (X-RateLimit-*)
 *   - Tier-based limits (free / pro / enterprise)
 *   - Bypass list for trusted clients (service accounts, internal health checks)
 *   - Configurable limits that can be overridden per-key
 *
 * Usage:
 *   import { createRateLimitMiddleware } from './rateLimitMiddleware';
 *   const rl = createRateLimitMiddleware({ service: rateLimitingService });
 *   // express-style: app.use(rl);
 */

import { SubscriptionTier } from '../../src/types/subscription';
import { RateLimitingService } from './rateLimitingService';
import { TIER_RATE_LIMITS, mapSubscriptionToRateLimitTier } from '../../src/types/rateLimiting';

// ---------------------------------------------------------------------------
// Minimal request / response types — structural, no Express dep required
// ---------------------------------------------------------------------------

export interface RateLimitRequest {
  method?: string;
  path?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  ip?: string;
}

export interface RateLimitResponse {
  setHeader(name: string, value: string | number): void;
  writeHead?(status: number, headers?: Record<string, string>): void;
  status?(code: number): RateLimitResponse;
  end?(body?: string): void;
  json?(body: unknown): void;
}

export type NextFn = (err?: unknown) => void;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RateLimitMiddlewareOptions {
  /** The rate limiting service instance to use. */
  service: RateLimitingService;
  /**
   * Extract the API key from the request.
   * Defaults to `x-api-key` header, then `Authorization: Bearer <token>`.
   */
  keyFn?: (req: RateLimitRequest) => string | undefined;
  /**
   * Extract the user ID from the request.
   * Defaults to `x-user-id` header.
   */
  userIdFn?: (req: RateLimitRequest) => string | undefined;
  /**
   * Determine the subscription tier for the API key / user.
   * Defaults to FREE tier for unknown keys.
   */
  tierFn?: (apiKey: string, userId?: string) => SubscriptionTier;
  /**
   * Paths that bypass rate limiting entirely (e.g. health checks).
   * String match uses exact prefix matching.
   */
  bypassPaths?: string[];
  /**
   * API keys that bypass rate limiting (trusted service accounts).
   */
  bypassKeys?: Set<string>;
  /**
   * User IDs that bypass rate limiting (internal accounts).
   */
  bypassUsers?: Set<string>;
  /** When true, only add headers — do not reject requests. Default: false. */
  softMode?: boolean;
}

// ---------------------------------------------------------------------------
// Header names
// ---------------------------------------------------------------------------

export const RATE_LIMIT_HEADERS = {
  LIMIT: 'X-RateLimit-Limit',
  REMAINING: 'X-RateLimit-Remaining',
  RESET: 'X-RateLimit-Reset',
  RETRY_AFTER: 'Retry-After',
  POLICY: 'X-RateLimit-Policy',
  USER_LIMIT: 'X-UserRateLimit-Limit',
  USER_REMAINING: 'X-UserRateLimit-Remaining',
  USER_RESET: 'X-UserRateLimit-Reset',
} as const;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function getHeader(req: RateLimitRequest, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function defaultKeyFn(req: RateLimitRequest): string | undefined {
  const fromHeader = getHeader(req, 'x-api-key');
  if (fromHeader) return fromHeader;

  const auth = getHeader(req, 'authorization');
  if (auth.startsWith('Bearer ')) return auth.slice(7);

  return undefined;
}

function defaultUserIdFn(req: RateLimitRequest): string | undefined {
  const userId = getHeader(req, 'x-user-id');
  return userId || undefined;
}

function defaultTierFn(_apiKey: string, _userId?: string): SubscriptionTier {
  return SubscriptionTier.FREE;
}

function sendRateLimitExceeded(
  res: RateLimitResponse,
  retryAfterMs: number,
  limit: number,
  resetAt: number,
): void {
  const retryAfterSecs = Math.ceil(retryAfterMs / 1_000);

  if (res.writeHead) {
    res.writeHead(429, {
      'Content-Type': 'application/json',
      [RATE_LIMIT_HEADERS.RETRY_AFTER]: String(retryAfterSecs),
      [RATE_LIMIT_HEADERS.LIMIT]: String(limit),
      [RATE_LIMIT_HEADERS.REMAINING]: '0',
      [RATE_LIMIT_HEADERS.RESET]: String(Math.ceil(resetAt / 1_000)),
    });
    res.end?.(
      JSON.stringify({
        status: 429,
        error: 'rate_limit_exceeded',
        message: `Rate limit exceeded. Retry after ${retryAfterSecs} seconds.`,
        retryAfter: retryAfterSecs,
        limit,
        remaining: 0,
        resetAt,
      }),
    );
  } else if (res.status && res.json) {
    res.setHeader(RATE_LIMIT_HEADERS.RETRY_AFTER, retryAfterSecs);
    res.setHeader(RATE_LIMIT_HEADERS.REMAINING, 0);
    res.status(429).json({
      status: 429,
      error: 'rate_limit_exceeded',
      message: `Rate limit exceeded. Retry after ${retryAfterSecs} seconds.`,
      retryAfter: retryAfterSecs,
      limit,
      remaining: 0,
      resetAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an Express-compatible rate limiting middleware.
 *
 * @example
 * ```ts
 * const rl = createRateLimitMiddleware({
 *   service: rateLimitingService,
 *   bypassPaths: ['/health', '/metrics'],
 *   bypassKeys: new Set(['internal-service-key-abc']),
 * });
 * app.use(rl);
 * ```
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions) {
  const {
    service,
    keyFn = defaultKeyFn,
    userIdFn = defaultUserIdFn,
    tierFn = defaultTierFn,
    bypassPaths = ['/health', '/metrics', '/metrics/plan-cache'],
    bypassKeys = new Set<string>(),
    bypassUsers = new Set<string>(),
    softMode = false,
  } = options;

  return function rateLimitMiddleware(
    req: RateLimitRequest,
    res: RateLimitResponse,
    next: NextFn,
  ): void {
    const path = req.path ?? req.url ?? '';

    // -----------------------------------------------------------------------
    // Bypass: path
    // -----------------------------------------------------------------------
    if (bypassPaths.some((bp) => path === bp || path.startsWith(bp))) {
      next();
      return;
    }

    const apiKey = keyFn(req);
    const userId = userIdFn(req);

    // -----------------------------------------------------------------------
    // Bypass: trusted keys / users
    // -----------------------------------------------------------------------
    if (apiKey && bypassKeys.has(apiKey)) {
      next();
      return;
    }
    if (userId && bypassUsers.has(userId)) {
      next();
      return;
    }

    // Need at least one identifier
    const identifier = apiKey ?? userId;
    if (!identifier) {
      // No credentials — use IP as fallback identifier
      const ip = req.ip ?? req.socket?.remoteAddress ?? 'anonymous';
      const tier = SubscriptionTier.FREE;
      const limits = TIER_RATE_LIMITS[tier];
      const check = service.checkRateLimit(ip, tier);

      res.setHeader(RATE_LIMIT_HEADERS.LIMIT, limits.hourlyLimit);
      res.setHeader(RATE_LIMIT_HEADERS.POLICY, 'ip-fallback');

      if (!check.allowed && !softMode) {
        sendRateLimitExceeded(res, check.retryAfterMs ?? 60_000, limits.hourlyLimit, Date.now() + (check.retryAfterMs ?? 60_000));
        return;
      }

      if (check.allowed) {
        service.recordRequest(ip, tier, path, 200, 0);
        const status = service.getRateLimitStatus(ip, tier);
        res.setHeader(RATE_LIMIT_HEADERS.REMAINING, status.remaining.hourly);
        res.setHeader(RATE_LIMIT_HEADERS.RESET, Math.ceil(status.resetAt.hourly / 1_000));
      }

      next();
      return;
    }

    const tier = tierFn(apiKey ?? identifier, userId);
    const limits = TIER_RATE_LIMITS[tier];
    const publicTier = mapSubscriptionToRateLimitTier(tier);

    // -----------------------------------------------------------------------
    // Per-API-key check
    // -----------------------------------------------------------------------
    if (apiKey) {
      const check = service.checkRateLimit(apiKey, tier);
      const status = service.getRateLimitStatus(apiKey, tier);

      res.setHeader(RATE_LIMIT_HEADERS.LIMIT, limits.hourlyLimit);
      res.setHeader(RATE_LIMIT_HEADERS.REMAINING, status.remaining.hourly);
      res.setHeader(RATE_LIMIT_HEADERS.RESET, Math.ceil(status.resetAt.hourly / 1_000));
      res.setHeader(
        RATE_LIMIT_HEADERS.POLICY,
        `${publicTier};hourly=${limits.hourlyLimit};daily=${limits.dailyLimit};burst=${limits.burstLimit};refill=${limits.refillRatePerSecond}/s`,
      );

      if (!check.allowed && !softMode) {
        sendRateLimitExceeded(
          res,
          check.retryAfterMs ?? 60_000,
          limits.hourlyLimit,
          status.resetAt.hourly,
        );
        return;
      }
    }

    // -----------------------------------------------------------------------
    // Per-user check (aggregate)
    // -----------------------------------------------------------------------
    if (userId) {
      const userKey = `user:${userId}`;
      const userCheck = service.checkUserRateLimit(userKey, tier);
      const userStatus = service.getUserRateLimitStatus(userKey, tier);

      res.setHeader(RATE_LIMIT_HEADERS.USER_LIMIT, limits.hourlyLimit * 5); // users get 5x key limit
      res.setHeader(RATE_LIMIT_HEADERS.USER_REMAINING, userStatus.remaining.hourly);
      res.setHeader(RATE_LIMIT_HEADERS.USER_RESET, Math.ceil(userStatus.resetAt.hourly / 1_000));

      if (!userCheck.allowed && !softMode) {
        sendRateLimitExceeded(
          res,
          userCheck.retryAfterMs ?? 60_000,
          limits.hourlyLimit * 5,
          userStatus.resetAt.hourly,
        );
        return;
      }
    }

    // -----------------------------------------------------------------------
    // Record the request (async, non-blocking for latency)
    // -----------------------------------------------------------------------
    const effectiveKey = apiKey ?? `user:${userId!}`;
    service.recordRequest(effectiveKey, tier, path, 200, 0);
    if (userId) {
      service.recordUserRequest(`user:${userId}`, tier, path);
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Convenience: attach rate-limit status to response after request completes
// ---------------------------------------------------------------------------

/**
 * Post-request middleware that refreshes rate-limit headers with the final
 * status (useful when the actual response code differs from 200).
 */
export function createRateLimitStatusMiddleware(options: RateLimitMiddlewareOptions) {
  const {
    service,
    keyFn = defaultKeyFn,
    userIdFn = defaultUserIdFn,
    tierFn = defaultTierFn,
  } = options;

  return function rateLimitStatus(
    req: RateLimitRequest,
    res: RateLimitResponse,
    next: NextFn,
  ): void {
    const apiKey = keyFn(req);
    const userId = userIdFn(req);
    const identifier = apiKey ?? userId;

    if (identifier) {
      const tier = tierFn(apiKey ?? identifier, userId);
      const limits = TIER_RATE_LIMITS[tier];
      const status = service.getRateLimitStatus(identifier, tier);

      res.setHeader(RATE_LIMIT_HEADERS.LIMIT, limits.hourlyLimit);
      res.setHeader(RATE_LIMIT_HEADERS.REMAINING, status.remaining.hourly);
      res.setHeader(RATE_LIMIT_HEADERS.RESET, Math.ceil(status.resetAt.hourly / 1_000));
    }

    next();
  };
}
