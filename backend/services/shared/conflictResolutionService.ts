/**
 * @file conflictResolutionService.ts
 * @description Issue #613 - Client-side service for handling OCC conflicts.
 *
 * This service provides a wrapper for API mutation functions to automatically
 * handle 409 version conflicts with a retry mechanism.
 */

import { create } from 'zustand';
import { ApiErrorResponse } from '../../../backend/services/shared/apiResponse';



export interface ConflictState<T> {
  entityId: string | number;
  /** The user's attempted changes that were rejected. */
  localState: T;
  /** The state of the entity on the server that caused the conflict. */
  remoteState: T;
  /** The error response from the server. */
  error: ApiErrorResponse;
}

interface ConflictStore<T> {
  conflict: ConflictState<T> | null;
  resolve: (conflict: ConflictState<T> | null) => void;
}

// A generic Zustand store for managing a single, active conflict.
// In a real app, you might want a map of conflicts by entityId.
export const useConflictStore = create<ConflictStore<object>>((set) => ({
  conflict: null,
  resolve: (conflict) => set({ conflict }),
}));

export interface RetryOptions<T extends { id: string | number; version: number }> {
  /** The mutation function to wrap. It must accept the entity to save. */
  mutationFn: (entity: T) => Promise<ApiErrorResponse | { success: true; data: T }>;
  /** A function to fetch the latest version of the entity from the server. */
  fetchLatestFn: (id: string | number) => Promise<T>;
  /** The initial entity state being submitted by the user. */
  entity: T & { id: string | number; version: number };
  /** Maximum number of retry attempts. Defaults to 3. */
  maxRetries?: number;
  /** Initial backoff delay in ms. Defaults to 100. */
  initialBackoffMs?: number;
  /** Optional callback for when retries are exhausted and manual resolution is required. */
  onConflictResolved?: (conflict: ConflictState<T>) => void;
}

/**
 * Wraps a mutation function with automatic retry logic for OCC conflicts.
 * If all retries fail, it populates the conflict store for manual resolution.
 */
export async function withConflictResolution<T extends { id: string | number; version: number }>(
  options: RetryOptions<T>,
): Promise<ApiErrorResponse | { success: true; data: T }> {
  const {
    mutationFn,
    fetchLatestFn,
    entity,
    maxRetries = 3,
    initialBackoffMs = 100,
    onConflictResolved,
  } = options;

  let lastError: ApiErrorResponse | null = null;
  let currentEntity = entity;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await mutationFn(currentEntity);

    if (response.success) {
      return response;
    }

    lastError = response;

    // Check if it's a version conflict error
    if (response.error.code === 'CONFLICT_VERSION_MISMATCH' && response.error.version !== undefined) {
      // It's a conflict, try to fetch the latest version and retry
      console.log(`Attempt ${attempt + 1}: Conflict detected. Retrying...`);

      // Exponential backoff
      if (attempt > 0) {
        const backoff = initialBackoffMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      try {
        const latestEntity = await fetchLatestFn(entity.id);
        // Merge user's changes onto the new base version
        currentEntity = { ...latestEntity, ...entity, version: latestEntity.version };
        continue; // Retry the loop
      } catch (fetchError) {
        console.error('Failed to fetch latest entity for conflict resolution:', fetchError);
        // If fetching the latest fails, we can't proceed automatically.
        break;
      }
    } else {
      // Not a conflict error, so fail immediately
      return response;
    }
  }

  // If all retries are exhausted, set the conflict state for the UI to handle
  if (lastError && lastError.error.code === 'CONFLICT_VERSION_MISMATCH') {
    try {
      const remoteState = await fetchLatestFn(entity.id);
      const conflict: ConflictState<T> = {
        entityId: entity.id,
        localState: entity,
        remoteState: remoteState,
        error: lastError,
      };
      // Use the callback if provided, otherwise fall back to the global store
      onConflictResolved ? onConflictResolved(conflict) : useConflictStore.getState().resolve(conflict);
    } catch (fetchError) {
      console.error('Failed to fetch latest entity for manual conflict resolution:', fetchError);
      // Return the original error as we cannot construct the full conflict state
    }
  }

  return lastError!;
}