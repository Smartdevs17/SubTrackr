import { DomainError } from '../shared/errors';
import { ErrorCode } from '../shared/apiResponse';

/**
 * Subscription module error codes.
 * All codes follow pattern: SUB_[CATEGORY]_[SPECIFIC]
 */
export const SubscriptionErrorCode = {
  NOT_FOUND: 'SUB_NOT_FOUND' as ErrorCode,
  ALREADY_EXISTS: 'SUB_ALREADY_EXISTS' as ErrorCode,
  INVALID_STATE: 'SUB_INVALID_STATE' as ErrorCode,
  EVENT_STORE_FULL: 'SUB_EVENT_STORE_FULL' as ErrorCode,
  REPLAY_FAILED: 'SUB_REPLAY_FAILED' as ErrorCode,
  SEARCH_INDEX_ERROR: 'SUB_SEARCH_INDEX_ERROR' as ErrorCode,
  INVALID_SEARCH_QUERY: 'SUB_INVALID_SEARCH_QUERY' as ErrorCode,
  RECONSTRUCTION_FAILED: 'SUB_RECONSTRUCTION_FAILED' as ErrorCode,
  ARCHIVE_FAILED: 'SUB_ARCHIVE_FAILED' as ErrorCode,
  VALIDATION_ERROR: 'SUB_VALIDATION_ERROR' as ErrorCode,
} as const;

export class SubscriptionError extends DomainError {
  constructor(code: ErrorCode, message: string, details?: Record<string, string>) {
    super(code, message, details);
  }

  static notFound(id: string): SubscriptionError {
    return new SubscriptionError(SubscriptionErrorCode.NOT_FOUND, `Subscription not found: ${id}`, { id });
  }

  static alreadyExists(id: string): SubscriptionError {
    return new SubscriptionError(SubscriptionErrorCode.ALREADY_EXISTS, `Subscription already exists: ${id}`, { id });
  }

  static invalidState(id: string, expected: string, actual: string): SubscriptionError {
    return new SubscriptionError(
      SubscriptionErrorCode.INVALID_STATE,
      `Invalid state for subscription ${id}: expected ${expected}, got ${actual}`,
      { id, expected, actual }
    );
  }
}
