/**
 * Typed errors for the sync module.
 */

export const SyncErrorCode = {
  INVALID_REQUEST: 'SYNC_INVALID_REQUEST',
  INVALID_OPERATION: 'SYNC_INVALID_OPERATION',
  ENTITY_NOT_FOUND: 'SYNC_ENTITY_NOT_FOUND',
  CONFLICT_UNRESOLVED: 'SYNC_CONFLICT_UNRESOLVED',
  LOG_ERROR: 'SYNC_LOG_ERROR',
} as const;

export type SyncErrorCode = (typeof SyncErrorCode)[keyof typeof SyncErrorCode];

export class SyncError extends Error {
  readonly code: SyncErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: SyncErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.details = details;
  }

  static invalidRequest(reason: string): SyncError {
    return new SyncError(SyncErrorCode.INVALID_REQUEST, `Invalid sync request: ${reason}`, { reason });
  }

  static entityNotFound(entityId: string): SyncError {
    return new SyncError(SyncErrorCode.ENTITY_NOT_FOUND, `Entity not found: ${entityId}`, { entityId });
  }

  static conflictUnresolved(entityId: string, field: string): SyncError {
    return new SyncError(
      SyncErrorCode.CONFLICT_UNRESOLVED,
      `Unresolved conflict on entity ${entityId} field ${field}`,
      { entityId, field },
    );
  }
}
