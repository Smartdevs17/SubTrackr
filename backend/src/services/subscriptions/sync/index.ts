/**
 * Sync module — public API barrel.
 *
 * Re-exports the CRDT engine facade, the event log, and the pure
 * projection utilities. The underlying implementations live in
 * `backend/sync/` and are not duplicated here.
 */

// Types
export type {
  CRDTOperation,
  CRDTOpType,
  CRDTSyncRequest,
  CRDTSyncResponse,
  CRDTConflict,
  EntityCRDTState,
  LWWMap,
  ORSet,
  PNCounter,
  SyncEvent,
  NewSyncEvent,
  AppendResult,
  SyncEventLog,
  SyncEngineStats,
  SyncEngineOptions,
  SyncLogger,
} from './types';

// Errors
export { SyncError, SyncErrorCode } from './errors';

// Engine facade
export { SyncEngineService, syncEngineService } from './syncEngineService';

// Re-export log and projection directly so callers can inject custom logs
export { InMemorySyncEventLog } from '../../../../sync/eventLog';
export {
  applyOperation,
  applyEvent,
  mergeEntityStates,
  replay,
  emptyEntity,
  EntityProjection,
} from '../../../../sync/projection';
