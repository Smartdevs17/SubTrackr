import { DomainError } from '../errors';
import { ErrorCode } from '../apiResponse';

export const LockingErrorCode = {
  ACQUISITION_TIMEOUT: 'LOCK_ACQUISITION_TIMEOUT' as ErrorCode,
  DEADLOCK_DETECTED: 'LOCK_DEADLOCK_DETECTED' as ErrorCode,
  RELEASE_FAILED: 'LOCK_RELEASE_FAILED' as ErrorCode,
} as const;

export class LockingError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(code, message, details);
  }

  static acquisitionTimeout(subscriptionId: string, timeoutMs: number): LockingError {
    return new LockingError(
      LockingErrorCode.ACQUISITION_TIMEOUT,
      `Failed to acquire lock for subscription ${subscriptionId} within ${timeoutMs}ms`,
      { subscriptionId, timeoutMs: String(timeoutMs) }
    );
  }

  static deadlockDetected(subscriptionId: string): LockingError {
    return new LockingError(
      LockingErrorCode.DEADLOCK_DETECTED,
      `Deadlock detected for subscription ${subscriptionId}`,
      { subscriptionId }
    );
  }

  static releaseFailed(subscriptionId: string, reason: string): LockingError {
    return new LockingError(
      LockingErrorCode.RELEASE_FAILED,
      `Failed to release lock for subscription ${subscriptionId}: ${reason}`,
      { subscriptionId, reason }
    );
  }
}
