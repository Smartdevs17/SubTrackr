import { logger } from './logging';

/**
 * Configuration for progressive delay tiers.
 * Each tier specifies the number of consecutive failures required to trigger
 * the associated lockout duration in minutes.
 * Tiers should be ordered in ascending order of thresholds.
 */
export interface LockoutTier {
  threshold: number;
  lockoutMinutes: number;
}

export interface LockoutStatus {
  locked: boolean;
  remainingMs: number;
  failedAttempts: number;
}

export interface LockoutConfig {
  tiers: LockoutTier[];
  /** Maximum time (in ms) to retain failure counts after the last activity before resetting */
  retentionMs: number;
}

const DEFAULT_CONFIG: LockoutConfig = {
  tiers: [
    { threshold: 3, lockoutMinutes: 5 },
    { threshold: 6, lockoutMinutes: 15 },
    { threshold: 9, lockoutMinutes: 60 },
  ],
  retentionMs: 24 * 60 * 60 * 1000, // 24 hours
};

interface AccountLockoutData {
  failedAttempts: number;
  lockoutUntil: number;
  lastUpdated: number;
}

/**
 * Provides progressive account lockout mechanisms to mitigate brute force
 * and credential stuffing attacks on authentication endpoints.
 */
export class AccountLockoutService {
  // In-memory store for tracking lockouts.
  // In a multi-node production setup, this would be backed by Redis or Memcached.
  private store = new Map<string, AccountLockoutData>();
  private readonly config: LockoutConfig;

  constructor(config: Partial<LockoutConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Sort tiers in descending order to easily find the highest applicable tier
    this.config.tiers = [...this.config.tiers].sort((a, b) => b.threshold - a.threshold);
  }

  /**
   * Cleans up expired entries from the store.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, data] of this.store.entries()) {
      if (now - data.lastUpdated > this.config.retentionMs) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Retrieves current data for an identifier, resetting if the retention period has passed.
   */
  private getValidData(identifier: string, now: number): AccountLockoutData {
    const data = this.store.get(identifier);
    if (!data) {
      return { failedAttempts: 0, lockoutUntil: 0, lastUpdated: now };
    }

    if (now - data.lastUpdated > this.config.retentionMs) {
      this.store.delete(identifier);
      return { failedAttempts: 0, lockoutUntil: 0, lastUpdated: now };
    }

    return data;
  }

  /**
   * Checks the current lockout status for a given identifier (e.g. email or IP).
   * @param identifier The account identifier to check.
   */
  async checkLockout(identifier: string): Promise<LockoutStatus> {
    const now = Date.now();
    const data = this.getValidData(identifier, now);

    if (data.lockoutUntil > now) {
      return {
        locked: true,
        remainingMs: data.lockoutUntil - now,
        failedAttempts: data.failedAttempts,
      };
    }

    return {
      locked: false,
      remainingMs: 0,
      failedAttempts: data.failedAttempts,
    };
  }

  /**
   * Records a failed authentication attempt and calculates progressive delays.
   * @param identifier The account identifier.
   */
  async recordFailure(identifier: string): Promise<LockoutStatus> {
    const now = Date.now();
    // Run cleanup periodically (approx 1 in 100 calls) to avoid memory leaks
    if (Math.random() < 0.01) {
      this.cleanup();
    }

    const data = this.getValidData(identifier, now);

    // If currently locked out, we don't increase failures, we just return the active lockout
    if (data.lockoutUntil > now) {
      logger.warn('Lockout bypassed failure recording', { identifier, remainingMs: data.lockoutUntil - now });
      return {
        locked: true,
        remainingMs: data.lockoutUntil - now,
        failedAttempts: data.failedAttempts,
      };
    }

    data.failedAttempts += 1;
    data.lastUpdated = now;

    // Determine if a lockout tier was reached
    let applyLockoutMinutes = 0;
    for (const tier of this.config.tiers) {
      if (data.failedAttempts >= tier.threshold) {
        applyLockoutMinutes = tier.lockoutMinutes;
        break; // found the highest tier because tiers are sorted descending
      }
    }

    if (applyLockoutMinutes > 0) {
      data.lockoutUntil = now + applyLockoutMinutes * 60 * 1000;
      logger.warn('Account locked out due to excessive failures', {
        identifier,
        failedAttempts: data.failedAttempts,
        lockoutMinutes: applyLockoutMinutes,
      });
    }

    this.store.set(identifier, data);

    const locked = applyLockoutMinutes > 0;
    return {
      locked,
      remainingMs: locked ? applyLockoutMinutes * 60 * 1000 : 0,
      failedAttempts: data.failedAttempts,
    };
  }

  /**
   * Resets the failed attempts and lockout status for an identifier.
   * Should be called upon successful authentication.
   * @param identifier The account identifier.
   */
  async resetFailures(identifier: string): Promise<void> {
    const data = this.store.get(identifier);
    if (data) {
      this.store.delete(identifier);
      logger.info('Account lockout reset', { identifier });
    }
  }

  /**
   * Manually clears the internal store (useful for testing).
   */
  clearStore(): void {
    this.store.clear();
  }
}

export const accountLockoutService = new AccountLockoutService();
