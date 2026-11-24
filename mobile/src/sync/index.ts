/** Public API for offline-first subscription edits (Issue #1987). */

export { isVersionConflict } from './conflictPolicy';
export {
  OUTBOX_STORAGE_KEY,
  OutboxCorruptError,
  RecordConflictedError,
  SyncOutbox,
} from './outbox';
export type { SyncOutboxOptions } from './outbox';
export {
  createConsoleSyncTelemetry,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_PUSH_TIMEOUT_MS,
  SyncEngine,
} from './engine';
export type { FlushSummary, SyncEngineOptions } from './engine';
export type {
  HeldReason,
  HeldUpdate,
  PendingUpdate,
  PushResult,
  RemoteSubscriptionRecord,
  SyncEvent,
  SyncEventType,
  SyncLogger,
  SyncedSubscriptionPatch,
  SyncState,
  SyncStatus,
  SyncStorage,
  SyncTelemetry,
  SyncTransport,
} from './types';
