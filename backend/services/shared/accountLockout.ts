/**
 * Account Lockout Service — SubTrackr
 *
 * Implements progressive lockout with exponentially increasing delays
 * after repeated failed authentication attempts.
 */

import { createHash } from 'node:crypto';

export interface LockoutConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  windowMs: number;
  lockoutDurationMs: number;
}

export interface LockoutRecord {
  identifier: string;
  failedAttempts: number;
  lockedUntil: number | null;
  lastFailedAt: number | null;
  totalLockouts: number;
  currentDelayMs: number;
}

export interface LockoutCheckResult {
  locked: boolean;
  remainingMs: number;
  attemptsRemaining: number;
  currentDelayMs: number;
}

const DEFAULT_LOCKOUT_CONFIG: LockoutConfig = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 3600000,
  multiplier: 2,
  windowMs: 900000,
  lockoutDurationMs: 900000,
};

export class AccountLockoutService {
  private records = new Map<string, LockoutRecord>();
  private config: LockoutConfig;

  constructor(config: Partial<LockoutConfig> = {}) {
    this.config = { ...DEFAULT_LOCKOUT_CONFIG, ...config };
  }

  private hashIdentifier(identifier: string): string {
    return createHash('sha256').update(identifier.toLowerCase().trim()).digest('hex').slice(0, 16);
  }

  private getOrCreateRecord(identifier: string): LockoutRecord {
    const hash = this.hashIdentifier(identifier);
    const existing = this.records.get(hash);
    if (existing) return existing;

    const record: LockoutRecord = {
      identifier: hash,
      failedAttempts: 0,
      lockedUntil: null,
      lastFailedAt: null,
      totalLockouts: 0,
      currentDelayMs: this.config.baseDelayMs,
    };
    this.records.set(hash, record);
    return record;
  }

  private resetWindowIfNeeded(record: LockoutRecord): void {
    if (record.lastFailedAt && Date.now() - record.lastFailedAt > this.config.windowMs) {
      record.failedAttempts = 0;
      record.currentDelayMs = this.config.baseDelayMs;
    }
  }

  check(identifier: string): LockoutCheckResult {
    const record = this.getOrCreateRecord(identifier);
    this.resetWindowIfNeeded(record);

    if (record.lockedUntil) {
      const remainingMs = record.lockedUntil - Date.now();
      if (remainingMs > 0) {
        return {
          locked: true,
          remainingMs,
          attemptsRemaining: 0,
          currentDelayMs: record.currentDelayMs,
        };
      }
      record.lockedUntil = null;
      record.failedAttempts = 0;
      record.currentDelayMs = this.config.baseDelayMs;
    }

    return {
      locked: false,
      remainingMs: 0,
      attemptsRemaining: Math.max(0, this.config.maxAttempts - record.failedAttempts),
      currentDelayMs: record.currentDelayMs,
    };
  }

  recordFailure(identifier: string): LockoutCheckResult {
    const record = this.getOrCreateRecord(identifier);
    this.resetWindowIfNeeded(record);

    record.failedAttempts += 1;
    record.lastFailedAt = Date.now();

    if (record.failedAttempts >= this.config.maxAttempts) {
      const delay = Math.min(
        record.currentDelayMs,
        this.config.maxDelayMs,
      );
      record.lockedUntil = Date.now() + Math.max(delay, this.config.lockoutDurationMs);
      record.totalLockouts += 1;
      record.currentDelayMs = Math.min(
        record.currentDelayMs * this.config.multiplier,
        this.config.maxDelayMs,
      );

      return {
        locked: true,
        remainingMs: record.lockedUntil - Date.now(),
        attemptsRemaining: 0,
        currentDelayMs: record.currentDelayMs,
      };
    }

    return {
      locked: false,
      remainingMs: 0,
      attemptsRemaining: this.config.maxAttempts - record.failedAttempts,
      currentDelayMs: record.currentDelayMs,
    };
  }

  recordSuccess(identifier: string): void {
    const hash = this.hashIdentifier(identifier);
    const record = this.records.get(hash);
    if (record) {
      record.failedAttempts = 0;
      record.lockedUntil = null;
      record.currentDelayMs = this.config.baseDelayMs;
    }
  }

  forceUnlock(identifier: string): boolean {
    const hash = this.hashIdentifier(identifier);
    const record = this.records.get(hash);
    if (!record) return false;

    record.lockedUntil = null;
    record.failedAttempts = 0;
    record.currentDelayMs = this.config.baseDelayMs;
    return true;
  }

  getRecord(identifier: string): LockoutRecord | undefined {
    const hash = this.hashIdentifier(identifier);
    return this.records.get(hash);
  }

  getAllLockedIdentifiers(): string[] {
    const now = Date.now();
    const locked: string[] = [];
    for (const [hash, record] of this.records) {
      if (record.lockedUntil && record.lockedUntil > now) {
        locked.push(hash);
      }
    }
    return locked;
  }

  getStats(): {
    totalTracked: number;
    currentlyLocked: number;
    totalLockouts: number;
  } {
    const now = Date.now();
    let currentlyLocked = 0;
    let totalLockouts = 0;

    for (const record of this.records.values()) {
      if (record.lockedUntil && record.lockedUntil > now) currentlyLocked++;
      totalLockouts += record.totalLockouts;
    }

    return {
      totalTracked: this.records.size,
      currentlyLocked,
      totalLockouts,
    };
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [hash, record] of this.records) {
      const isExpired = !record.lockedUntil || record.lockedUntil < now;
      const hasNoFailures = record.failedAttempts === 0;
      const windowExpired = record.lastFailedAt && now - record.lastFailedAt > this.config.windowMs * 2;

      if (isExpired && (hasNoFailures || windowExpired)) {
        this.records.delete(hash);
        removed++;
      }
    }

    return removed;
  }
}

export const accountLockoutService = new AccountLockoutService();
