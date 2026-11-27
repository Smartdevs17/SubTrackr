/**
 * Sync Engine — facade over the CRDT merge engine at `backend/sync/`.
 *
 * This module's job is to wire logging and metrics into the existing engine
 * rather than re-implement it. The engine itself (`SyncEngine` in
 * `crdtMergeService.ts`) is the source of truth for CRDT logic.
 *
 * Usage:
 *
 *   import { syncEngineService } from '…/subscriptions/sync';
 *   const response = await syncEngineService.process(request);
 */

import { createPiiSafeLogger } from '../../../utils/logger';
import {
  SyncEngine,
  createSyncEngine,
  InvalidSyncRequestError,
} from '../../../../sync/crdtMergeService';
import { SyncError } from './errors';
import { metrics, MetricName } from '../observability';
import type { SyncEngineOptions } from './types';
import type { CRDTSyncRequest, CRDTSyncResponse, EntityCRDTState } from './types';

const logger = createPiiSafeLogger('subscriptions.sync.engine');

export class SyncEngineService {
  private readonly engine: SyncEngine;

  constructor(options?: SyncEngineOptions) {
    this.engine = createSyncEngine(options);
  }

  /**
   * Process a CRDT sync request.
   *
   * Validates, delegates to the underlying engine, records metrics, and logs
   * the outcome.
   *
   * @throws {SyncError} for malformed requests.
   */
  process(request: CRDTSyncRequest): CRDTSyncResponse {
    const start = Date.now();
    try {
      const response = this.engine.process(request);
      const durationMs = Date.now() - start;

      // ── Observability ─────────────────────────────────────────────────────
      metrics.increment(MetricName.SYNC_REQUEST, { status: 'ok' });
      metrics.timing(MetricName.SYNC_REQUEST, durationMs, { status: 'ok' });
      metrics.increment(MetricName.SYNC_OPS_APPLIED, {}, response.mergedStates.length);
      if (response.conflicts.length > 0) {
        metrics.increment(MetricName.SYNC_CONFLICTS, {}, response.conflicts.length);
      }

      logger.info('sync.engine.processed', {
        nodeId: request.nodeId,
        opsIn: request.operations.length,
        remoteOpsOut: response.remoteOperations.length,
        conflicts: response.conflicts.length,
        cursor: response.cursor,
        durationMs,
      });

      return response;
    } catch (err) {
      const durationMs = Date.now() - start;
      metrics.increment(MetricName.SYNC_REQUEST, { status: 'error' });
      metrics.increment(MetricName.SYNC_ERROR);
      metrics.timing(MetricName.SYNC_REQUEST, durationMs, { status: 'error' });

      if (err instanceof InvalidSyncRequestError) {
        throw SyncError.invalidRequest(err.message);
      }
      logger.error('sync.engine.error', {
        nodeId: request.nodeId,
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      });
      throw err;
    }
  }

  /**
   * Retrieve the current projected state of an entity.
   */
  getEntity(entityId: string): EntityCRDTState {
    return this.engine.getEntity(entityId);
  }

  stats() {
    return this.engine.stats();
  }
}

export const syncEngineService = new SyncEngineService();
