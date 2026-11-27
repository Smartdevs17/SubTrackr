/**
 * Typed errors for the lifecycle module.
 */

export const LifecycleErrorCode = {
  NOT_FOUND: 'LIFECYCLE_NOT_FOUND',
  ALREADY_CANCELLED: 'LIFECYCLE_ALREADY_CANCELLED',
  ALREADY_PAUSED: 'LIFECYCLE_ALREADY_PAUSED',
  NOT_PAUSED: 'LIFECYCLE_NOT_PAUSED',
  TRIAL_ACTIVE: 'LIFECYCLE_TRIAL_ACTIVE',
  TRIAL_NOT_FOUND: 'LIFECYCLE_TRIAL_NOT_FOUND',
  TRIAL_ALREADY_CONVERTED: 'LIFECYCLE_TRIAL_ALREADY_CONVERTED',
  INVALID_STATE: 'LIFECYCLE_INVALID_STATE',
  LOCK_TIMEOUT: 'LIFECYCLE_LOCK_TIMEOUT',
  RENEWAL_FAILED: 'LIFECYCLE_RENEWAL_FAILED',
  PAUSE_LIMIT_EXCEEDED: 'LIFECYCLE_PAUSE_LIMIT_EXCEEDED',
  SLA_BREACH: 'LIFECYCLE_SLA_BREACH',
} as const;

export type LifecycleErrorCode = (typeof LifecycleErrorCode)[keyof typeof LifecycleErrorCode];

export class LifecycleError extends Error {
  readonly code: LifecycleErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: LifecycleErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'LifecycleError';
    this.code = code;
    this.details = details;
  }

  static notFound(subscriptionId: string): LifecycleError {
    return new LifecycleError(
      LifecycleErrorCode.NOT_FOUND,
      `Subscription not found: ${subscriptionId}`,
      { subscriptionId },
    );
  }

  static alreadyCancelled(subscriptionId: string): LifecycleError {
    return new LifecycleError(
      LifecycleErrorCode.ALREADY_CANCELLED,
      `Subscription ${subscriptionId} is already cancelled`,
      { subscriptionId },
    );
  }

  static alreadyPaused(subscriptionId: string): LifecycleError {
    return new LifecycleError(
      LifecycleErrorCode.ALREADY_PAUSED,
      `Subscription ${subscriptionId} is already paused`,
      { subscriptionId },
    );
  }

  static notPaused(subscriptionId: string): LifecycleError {
    return new LifecycleError(
      LifecycleErrorCode.NOT_PAUSED,
      `Subscription ${subscriptionId} is not paused`,
      { subscriptionId },
    );
  }

  static invalidState(subscriptionId: string, expected: string, actual: string): LifecycleError {
    return new LifecycleError(
      LifecycleErrorCode.INVALID_STATE,
      `Invalid state for subscription ${subscriptionId}: expected ${expected}, got ${actual}`,
      { subscriptionId, expected, actual },
    );
  }

  static lockTimeout(subscriptionId: string): LifecycleError {
    return new LifecycleError(
      LifecycleErrorCode.LOCK_TIMEOUT,
      `Could not acquire lock for subscription ${subscriptionId}`,
      { subscriptionId },
    );
  }

  static trialNotFound(subscriptionId: string): LifecycleError {
    return new LifecycleError(
      LifecycleErrorCode.TRIAL_NOT_FOUND,
      `No active trial found for subscription ${subscriptionId}`,
      { subscriptionId },
    );
  }
}
