import { randomUUID } from 'crypto';
import { LockingError } from './errors';
import { logger } from '../logging';

export interface LockMetrics {
  lockAcquisitionTime: number[];
  contentionCount: number;
  timeoutCount: number;
}

export interface LockConfig {
  timeoutMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
}

const DEFAULT_CONFIG: LockConfig = {
  timeoutMs: 5000,
  retryAttempts: 3,
  retryBaseDelayMs: 100,
};

export class AdvisoryLockService {
  private heldLocks = new Map<string, { subscriptionId: string; acquiredAt: number }>();
  private metrics: LockMetrics = {
    lockAcquisitionTime: [],
    contentionCount: 0,
    timeoutCount: 0,
  };

  constructor(private config: LockConfig = DEFAULT_CONFIG) {}

  async acquire(subscriptionId: string): Promise<string> {
    const lockId = randomUUID();
    const deadline = Date.now() + this.config.timeoutMs;
    let attempt = 0;
    let lastError: Error | null = null;

    while (Date.now() < deadline && attempt < this.config.retryAttempts) {
      attempt++;
      const start = Date.now();

      try {
        if (this.tryAcquire(subscriptionId, lockId)) {
          const elapsed = Date.now() - start;
          this.metrics.lockAcquisitionTime.push(elapsed);
          this.heldLocks.set(lockId, { subscriptionId, acquiredAt: Date.now() });
          logger.info('Lock acquired', { subscriptionId, lockId, attempt, elapsedMs: elapsed });
          return lockId;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (this.isDeadlockError(err)) {
          this.metrics.contentionCount++;
          throw LockingError.deadlockDetected(subscriptionId);
        }
      }

      this.metrics.contentionCount++;
      const delay = this.calculateBackoff(attempt);
      await this.sleep(Math.min(delay, deadline - Date.now()));
    }

    this.metrics.timeoutCount++;
    throw LockingError.acquisitionTimeout(subscriptionId, this.config.timeoutMs);
  }

  async release(lockId: string): Promise<void> {
    const entry = this.heldLocks.get(lockId);
    if (!entry) {
      logger.warn('Attempted to release unknown lock', { lockId });
      return;
    }

    try {
      this.doRelease(entry.subscriptionId, lockId);
      this.heldLocks.delete(lockId);
      logger.info('Lock released', { subscriptionId: entry.subscriptionId, lockId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw LockingError.releaseFailed(entry.subscriptionId, message);
    }
  }

  async withLock<T>(subscriptionId: string, fn: () => Promise<T>): Promise<T> {
    const lockId = await this.acquire(subscriptionId);
    try {
      return await fn();
    } finally {
      await this.release(lockId);
    }
  }

  getMetrics(): LockMetrics {
    return { ...this.metrics, lockAcquisitionTime: [...this.metrics.lockAcquisitionTime] };
  }

  resetMetrics(): void {
    this.metrics = { lockAcquisitionTime: [], contentionCount: 0, timeoutCount: 0 };
  }

  private tryAcquire(subscriptionId: string, lockId: string): boolean {
    for (const [, entry] of this.heldLocks) {
      if (entry.subscriptionId === subscriptionId) {
        return false;
      }
    }
    return true;
  }

  private doRelease(subscriptionId: string, lockId: string): void {
    const entry = this.heldLocks.get(lockId);
    if (!entry || entry.subscriptionId !== subscriptionId) {
      throw new Error(`Lock mismatch: ${lockId} does not match subscription ${subscriptionId}`);
    }
  }

  private isDeadlockError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes('deadlock') || msg.includes('deadlock detected');
    }
    return false;
  }

  private calculateBackoff(attempt: number): number {
    return this.config.retryBaseDelayMs * Math.pow(3, attempt - 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
}

export const advisoryLockService = new AdvisoryLockService();
