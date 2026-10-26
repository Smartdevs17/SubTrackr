/**
 * Retry policy with exponential backoff for job processing.
 *
 * Provides:
 *   - Configurable max attempts per priority class
 *   - Exponential backoff with jitter (full-jitter strategy)
 *   - Per-priority class retry caps
 *   - Backoff delay calculation usable by WeightedFairQueue processors
 *
 * Full-jitter reduces thundering-herd on retry bursts:
 *   delay = random(0, base * 2^attempt)  capped at maxDelayMs
 *
 * @see https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */

import type { PriorityClass } from './types';

// ── Defaults ──────────────────────────────────────────────────────────────────

/** Base delay for first retry attempt (ms). */
export const DEFAULT_BASE_DELAY_MS = 1_000;
/** Maximum delay cap (ms). */
export const DEFAULT_MAX_DELAY_MS = 60_000;
/** Maximum attempts before a job is sent to the DLQ. */
export const DEFAULT_MAX_ATTEMPTS: Record<PriorityClass, number> = {
  critical: 10,
  high: 7,
  normal: 5,
  low: 3,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetryPolicyConfig {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: Partial<Record<PriorityClass, number>>;
  /** Multiplier per attempt. Default: 2 (doubling). */
  backoffMultiplier?: number;
  /** When true, uses full-jitter. When false, deterministic. Default: true. */
  jitter?: boolean;
  /** Injected random function for testing. Default: Math.random. */
  random?: () => number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  delayMs: number;
  attempt: number;
  reason?: string;
}

// ── RetryPolicy ───────────────────────────────────────────────────────────────

export class RetryPolicy {
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: Record<PriorityClass, number>;
  private readonly backoffMultiplier: number;
  private readonly jitter: boolean;
  private readonly random: () => number;

  constructor(config: RetryPolicyConfig = {}) {
    this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.maxAttempts = { ...DEFAULT_MAX_ATTEMPTS, ...config.maxAttempts };
    this.backoffMultiplier = config.backoffMultiplier ?? 2;
    this.jitter = config.jitter ?? true;
    this.random = config.random ?? Math.random;
  }

  /**
   * Decide whether to retry and how long to wait.
   *
   * @param priority - Priority class of the job.
   * @param attempt  - Number of attempts already made (0 = first failure).
   * @param error    - The error that caused the failure (for logging).
   */
  decide(priority: PriorityClass, attempt: number, error?: Error): RetryDecision {
    const maxAttempts = this.maxAttempts[priority];

    if (attempt >= maxAttempts) {
      return {
        shouldRetry: false,
        delayMs: 0,
        attempt,
        reason: `Max attempts (${maxAttempts}) exceeded for priority "${priority}"`,
      };
    }

    const delayMs = this.computeDelay(attempt);
    return {
      shouldRetry: true,
      delayMs,
      attempt: attempt + 1,
      reason: error?.message,
    };
  }

  /**
   * Compute the backoff delay for a given attempt number.
   * Uses full-jitter: random(0, base * multiplier^attempt) capped at maxDelayMs.
   */
  computeDelay(attempt: number): number {
    const exponential = this.baseDelayMs * Math.pow(this.backoffMultiplier, attempt);
    const capped = Math.min(exponential, this.maxDelayMs);
    if (this.jitter) {
      return Math.floor(this.random() * capped);
    }
    return Math.floor(capped);
  }

  getMaxAttempts(priority: PriorityClass): number {
    return this.maxAttempts[priority];
  }
}

/** Default retry policy instance (singletons are safe — stateless). */
export const defaultRetryPolicy = new RetryPolicy();
