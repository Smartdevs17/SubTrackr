/**
 * Shared types for the sync module.
 *
 * These are thin re-exports and extensions of the existing CRDT types from
 * `backend/shared/types/crdt.ts`. Consumers of this module get one stable
 * import location regardless of where the underlying definitions live.
 */

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
} from '../../../../../shared/types/crdt';

// ── Sync event log types ───────────────────────────────────────────────────────

export type { SyncEvent, NewSyncEvent, AppendResult, SyncEventLog } from '../../../../sync/eventLog';

// ── Engine stats & options ────────────────────────────────────────────────────

export type { SyncEngineStats, SyncEngineOptions, SyncLogger } from '../../../../sync/crdtMergeService';
