/**
 * @file OptimisticLockService.ts
 * @description Issue #613 - Service for Optimistic Concurrency Control (OCC).
 *
 * This service provides helpers to handle version-based optimistic locking.
 * It ensures that concurrent updates do not silently overwrite each other.
 */

import { fail, fromError, ok, ApiResponse } from '../apiResponse';
import { getLogger } from '../../../utils/logger';

const logger = getLogger('OptimisticLockService');

export interface VersionedEntity {
  id: string | number;
  version: number;
}

export interface UpdateOptions<T extends VersionedEntity> {
  /** The entity state from the client, including the version they think they are updating. */
  clientEntity: T;
  /** The current entity state from the database. */
  dbEntity: T;
  /** The user or process making the request. */
  actor: { id: string; type: 'user' | 'system' };
  /** The unique request ID for logging. */
  requestId?: string;
  /** If true, bypasses the version check (for admin overrides). */
  force?: boolean;
}

/**
 * Checks if an update operation can proceed by comparing client and database entity versions.
 *
 * @returns A successful ApiResponse if the update is allowed, or a 409 Conflict error response if not.
 */
export function checkVersion<T extends VersionedEntity>(
  options: UpdateOptions<T>,
): ApiResponse<void> {
  const { clientEntity, dbEntity, actor, requestId, force = false } = options;

  if (force) {
    logger.warn(
      {
        actor,
        entityId: dbEntity.id,
        clientVersion: clientEntity.version,
        dbVersion: dbEntity.version,
        requestId,
      },
      'OCC check bypassed with force=true',
    );
    return ok(undefined, requestId);
  }

  if (clientEntity.version !== dbEntity.version) {
    logger.warn(
      {
        actor,
        entityId: dbEntity.id,
        clientVersion: clientEntity.version,
        dbVersion: dbEntity.version,
        requestId,
      },
      'OCC conflict detected: version mismatch',
    );
    return fail(
      'CONFLICT_VERSION_MISMATCH',
      `The resource was updated by another process. Please refresh and try again.`,
      requestId,
      { version: dbEntity.version },
    );
  }

  return ok(undefined, requestId);
}

/**
 * Executes a version-checked update.
 *
 * @param updateFn A function that performs the database update. It receives the new version number.
 *                 It should return the updated entity or null/undefined if the update fails.
 * @returns The result of the update function, or a conflict error.
 */
export async function withOptimisticLock<T extends VersionedEntity, R>(
  options: UpdateOptions<T>,
  updateFn: (newVersion: number) => Promise<R | null>,
): Promise<ApiResponse<R>> {
  const versionCheckResult = checkVersion(options);
  if (!versionCheckResult.success) {
    return versionCheckResult;
  }

  const newVersion = options.dbEntity.version + 1;

  try {
    const result = await updateFn(newVersion);
    // Assuming the update function returns null if the DB update fails (e.g., row count 0)
    return result ? ok(result, options.requestId) : fromError(new Error('Update failed'), options.requestId);
  } catch (err) {
    return fromError(err, options.requestId);
  }
}