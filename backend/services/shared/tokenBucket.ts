/**
 * Token bucket rate limiter.
 *
 * Tokens refill continuously at `refillRatePerSecond` up to `capacity`.
 * Each request consumes one token (configurable). When the bucket is empty
 * the caller receives `allowed: false` and a `retryAfterMs` hint.
 */

export interface TokenBucketConfig {
  /** Maximum tokens the bucket can hold (burst capacity). */
  capacity: number;
  /** Tokens added per second (sustained rate). Must be > 0. */
  refillRatePerSecond: number;
}

export interface TokenBucketSnapshot {
  tokens: number;
  capacity: number;
  refillRatePerSecond: number;
  lastRefillAt: number;
}

export interface ConsumeResult {
  allowed: boolean;
  /** Tokens remaining after the attempt (may be fractional). */
  remaining: number;
  /** Milliseconds until at least `cost` tokens are available (0 when allowed). */
  retryAfterMs: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;
  private capacity: number;
  private refillRatePerSecond: number;
  private readonly now: () => number;

  constructor(config: TokenBucketConfig, options: { now?: () => number; initialTokens?: number } = {}) {
    if (config.capacity <= 0) {
      throw new Error('TokenBucket capacity must be > 0');
    }
    if (config.refillRatePerSecond <= 0) {
      throw new Error('TokenBucket refillRatePerSecond must be > 0');
    }

    this.capacity = config.capacity;
    this.refillRatePerSecond = config.refillRatePerSecond;
    this.now = options.now ?? Date.now;
    this.tokens = options.initialTokens ?? config.capacity;
    this.lastRefillAt = this.now();
  }

  /** Refill tokens based on elapsed time since last refill. */
  refill(): number {
    const ts = this.now();
    const elapsedMs = ts - this.lastRefillAt;
    if (elapsedMs > 0) {
      const tokensToAdd = (elapsedMs / 1_000) * this.refillRatePerSecond;
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefillAt = ts;
    }
    return this.tokens;
  }

  /**
   * Attempt to consume `cost` tokens.
   * Returns whether the request is allowed and when to retry if not.
   */
  tryConsume(cost = 1): ConsumeResult {
    this.refill();

    if (this.tokens >= cost) {
      this.tokens -= cost;
      return { allowed: true, remaining: this.tokens, retryAfterMs: 0 };
    }

    const deficit = cost - this.tokens;
    const retryAfterMs = Math.ceil((deficit / this.refillRatePerSecond) * 1_000);
    return { allowed: false, remaining: this.tokens, retryAfterMs };
  }

  /** Tokens available after a refill (floored for header display). */
  getRemaining(): number {
    return Math.floor(this.refill());
  }

  getCapacity(): number {
    return this.capacity;
  }

  getRefillRatePerSecond(): number {
    return this.refillRatePerSecond;
  }

  /** Replace capacity / refill rate while clamping current tokens. */
  reconfigure(config: Partial<TokenBucketConfig>): void {
    this.refill();
    if (config.capacity !== undefined) {
      if (config.capacity <= 0) throw new Error('TokenBucket capacity must be > 0');
      this.capacity = config.capacity;
      this.tokens = Math.min(this.tokens, config.capacity);
    }
    if (config.refillRatePerSecond !== undefined) {
      if (config.refillRatePerSecond <= 0) {
        throw new Error('TokenBucket refillRatePerSecond must be > 0');
      }
      this.refillRatePerSecond = config.refillRatePerSecond;
    }
  }

  /** Force-set token count (used by tests and migration from legacy state). */
  setTokens(tokens: number): void {
    this.tokens = Math.max(0, Math.min(this.capacity, tokens));
    this.lastRefillAt = this.now();
  }

  snapshot(): TokenBucketSnapshot {
    this.refill();
    return {
      tokens: this.tokens,
      capacity: this.capacity,
      refillRatePerSecond: this.refillRatePerSecond,
      lastRefillAt: this.lastRefillAt,
    };
  }
}

/**
 * Derive a sustained refill rate (tokens/sec) from an hourly request limit.
 * Floors at a small epsilon so empty buckets always recover.
 */
export function refillRateFromHourlyLimit(hourlyLimit: number): number {
  return Math.max(hourlyLimit / 3_600, 0.001);
}
