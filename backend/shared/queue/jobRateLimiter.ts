/**
 * Job-level rate limiter for external API jobs.
 *
 * Enforces per-service rate limits so jobs that call third-party APIs
 * (e.g., payment gateway, email provider, SMS) don't exceed their quotas.
 *
 * Uses a sliding-window token-bucket per service key. The in-memory
 * implementation is sufficient for a single-worker deployment; replace
 * with Redis INCR/EXPIRE for multi-worker environments.
 *
 * Usage:
 *   const limiter = new JobRateLimiter();
 *   limiter.register('stripe', { requestsPerWindow: 100, windowMs: 1000 });
 *
 *   const decision = limiter.check('stripe');
 *   if (!decision.allowed) {
 *     await sleep(decision.retryAfterMs);
 *   }
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Max requests allowed in each window. */
  requestsPerWindow: number;
  /** Window duration in ms. Default: 1000 (1 second). */
  windowMs?: number;
  /** Human-readable label for dashboards. */
  label?: string;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  /** How many ms to wait before retrying (0 when allowed). */
  retryAfterMs: number;
  /** Total requests made in current window. */
  windowCount: number;
  service: string;
}

export interface RateLimitStats {
  service: string;
  label: string;
  requestsPerWindow: number;
  windowMs: number;
  windowCount: number;
  remaining: number;
  throttledCount: number;
  windowResetsAt: number;
}

// ── Bucket ────────────────────────────────────────────────────────────────────

interface Bucket {
  config: Required<RateLimitConfig>;
  windowStart: number;
  windowCount: number;
  throttledCount: number;
}

// ── JobRateLimiter ────────────────────────────────────────────────────────────

export class JobRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly nowFn: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.nowFn = options.now ?? Date.now;
  }

  /**
   * Register a service with its rate limit configuration.
   * Safe to call multiple times — subsequent calls update the config.
   */
  register(service: string, config: RateLimitConfig): void {
    const existing = this.buckets.get(service);
    const resolved: Required<RateLimitConfig> = {
      requestsPerWindow: config.requestsPerWindow,
      windowMs: config.windowMs ?? 1_000,
      label: config.label ?? service,
    };
    this.buckets.set(service, {
      config: resolved,
      windowStart: existing?.windowStart ?? this.nowFn(),
      windowCount: existing?.windowCount ?? 0,
      throttledCount: existing?.throttledCount ?? 0,
    });
  }

  /**
   * Check and consume one token for the given service.
   *
   * If the service is not registered, the request is always allowed
   * (opt-in limiting rather than fail-closed).
   */
  check(service: string): RateLimitDecision {
    const bucket = this.buckets.get(service);
    if (!bucket) {
      return { allowed: true, remaining: Infinity, retryAfterMs: 0, windowCount: 0, service };
    }

    const now = this.nowFn();
    const { config } = bucket;

    // Slide the window if expired
    if (now - bucket.windowStart >= config.windowMs) {
      bucket.windowStart = now;
      bucket.windowCount = 0;
    }

    const remaining = config.requestsPerWindow - bucket.windowCount;
    if (remaining <= 0) {
      bucket.throttledCount += 1;
      const windowEndsAt = bucket.windowStart + config.windowMs;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, windowEndsAt - now),
        windowCount: bucket.windowCount,
        service,
      };
    }

    bucket.windowCount += 1;
    return {
      allowed: true,
      remaining: remaining - 1,
      retryAfterMs: 0,
      windowCount: bucket.windowCount,
      service,
    };
  }

  /** Get current stats for all registered services. */
  getStats(): RateLimitStats[] {
    const now = this.nowFn();
    return [...this.buckets.entries()].map(([service, bucket]) => {
      const { config } = bucket;
      const windowActive = now - bucket.windowStart < config.windowMs;
      return {
        service,
        label: config.label,
        requestsPerWindow: config.requestsPerWindow,
        windowMs: config.windowMs,
        windowCount: windowActive ? bucket.windowCount : 0,
        remaining: windowActive
          ? Math.max(0, config.requestsPerWindow - bucket.windowCount)
          : config.requestsPerWindow,
        throttledCount: bucket.throttledCount,
        windowResetsAt: bucket.windowStart + config.windowMs,
      };
    });
  }

  /** Reset counters for a specific service. */
  reset(service: string): void {
    const bucket = this.buckets.get(service);
    if (bucket) {
      bucket.windowStart = this.nowFn();
      bucket.windowCount = 0;
      bucket.throttledCount = 0;
    }
  }

  /** Reset all counters. */
  resetAll(): void {
    const now = this.nowFn();
    for (const bucket of this.buckets.values()) {
      bucket.windowStart = now;
      bucket.windowCount = 0;
      bucket.throttledCount = 0;
    }
  }
}

/** Default pre-configured limits for known external services. */
export function createDefaultJobRateLimiter(options: { now?: () => number } = {}): JobRateLimiter {
  const limiter = new JobRateLimiter(options);

  // Payment gateway (Stripe: 100 req/s in test, 100 req/s in production for most endpoints)
  limiter.register('stripe', { requestsPerWindow: 90, windowMs: 1_000, label: 'Stripe API' });
  // Email provider (SendGrid: 600/min default)
  limiter.register('sendgrid', { requestsPerWindow: 550, windowMs: 60_000, label: 'SendGrid Email' });
  // SMS provider (Twilio: ~1 req/s free tier; 100/s paid)
  limiter.register('twilio', { requestsPerWindow: 80, windowMs: 1_000, label: 'Twilio SMS' });
  // Push notifications (Expo: 1000/s)
  limiter.register('expo-push', { requestsPerWindow: 900, windowMs: 1_000, label: 'Expo Push' });
  // Blockchain RPC (conservative default)
  limiter.register('blockchain-rpc', { requestsPerWindow: 30, windowMs: 1_000, label: 'Blockchain RPC' });

  return limiter;
}
