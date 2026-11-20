/**
 * Server-side CRDT sync engine, event-sourced.
 *
 * Every incoming operation and client snapshot is appended to a `SyncEventLog`.
 * Entity state is a projection of that log (`projection.ts`), so it can always
 * be rebuilt by replay. The log gives the engine three properties:
 *
 * - Idempotency: an operation retried with the same `id` is applied once.
 * - Catch-up: clients pass the `cursor` from their last response as `since` and
 *   receive every operation other nodes appended after it in `remoteOperations`.
 * - Auditability: the full history of an entity is available from the log.
 *
 * The default engine uses an in-memory log. Inject a persistent `SyncEventLog`
 * through `createSyncEngine` for production deployments.
 */

import type {
  CRDTConflict,
  CRDTOperation,
  CRDTOpType,
  CRDTSyncRequest,
  CRDTSyncResponse,
  EntityCRDTState,
} from '../../shared/types/crdt';
import { createPiiSafeLogger } from '../src/utils/logger';
import { InMemorySyncEventLog, type SyncEventLog } from './eventLog';
import { EntityProjection } from './projection';

export type SyncLogger = { info(message: string, meta?: Record<string, unknown>): void };

export interface SyncEngineStats {
  requests: number;
  opsApplied: number;
  duplicateOps: number;
  snapshotsMerged: number;
  conflicts: number;
}

export interface SyncEngineOptions {
  log?: SyncEventLog;
  logger?: SyncLogger;
  now?: () => Date;
}

export class InvalidSyncRequestError extends Error {}

const OP_TYPES: ReadonlySet<CRDTOpType> = new Set([
  'lww_set',
  'orset_add',
  'orset_remove',
  'pncounter_increment',
  'pncounter_decrement',
]);

export class SyncEngine {
  readonly log: SyncEventLog;
  private readonly projection: EntityProjection;
  private readonly logger: SyncLogger;
  private readonly now: () => Date;
  private readonly counters: SyncEngineStats = {
    requests: 0,
    opsApplied: 0,
    duplicateOps: 0,
    snapshotsMerged: 0,
    conflicts: 0,
  };

  constructor(options: SyncEngineOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? new InMemorySyncEventLog(this.now);
    this.projection = new EntityProjection(this.log);
    this.logger = options.logger ?? createPiiSafeLogger('sync');
  }

  /** Current state of an entity, folded from the log. */
  getEntity(entityId: string): EntityCRDTState {
    return this.projection.get(entityId);
  }

  stats(): SyncEngineStats {
    return { ...this.counters };
  }

  /**
   * 1. Append the client's operations (timestamp order, deduplicated by id).
   * 2. Append the client's entity snapshots.
   * 3. Project every touched entity, collecting conflicts.
   * 4. Return the operations from other nodes the client has not seen yet.
   */
  process(request: CRDTSyncRequest): CRDTSyncResponse {
    const startedAt = Date.now();
    const conflicts: CRDTConflict[] = [];
    const touched = new Set<string>();
    let applied = 0;
    let duplicates = 0;

    const sortedOps = [...request.operations].sort((a, b) => a.timestamp - b.timestamp);
    for (const op of sortedOps) {
      const { duplicate } = this.log.append({ kind: 'op', op });
      if (duplicate) {
        duplicates += 1;
        continue;
      }
      applied += 1;
      touched.add(op.entityId);
    }

    for (const state of request.entityStates) {
      this.log.append({ kind: 'snapshot', nodeId: request.nodeId, state });
      touched.add(state.entityId);
    }

    const projected = new Map<string, EntityCRDTState>();
    for (const entityId of touched) {
      projected.set(entityId, this.projection.get(entityId, conflicts));
    }

    const syncedAt = this.now().toISOString();
    const mergedStates = request.entityStates.map((state) => ({
      ...projected.get(state.entityId)!,
      lastSyncedAt: syncedAt,
    }));
    const remoteOperations = this.missingOperations(request);
    const cursor = this.log.head();

    this.counters.requests += 1;
    this.counters.opsApplied += applied;
    this.counters.duplicateOps += duplicates;
    this.counters.snapshotsMerged += request.entityStates.length;
    this.counters.conflicts += conflicts.length;

    this.logger.info('sync.processed', {
      nodeId: request.nodeId,
      opsApplied: applied,
      duplicateOps: duplicates,
      snapshotsMerged: request.entityStates.length,
      conflicts: conflicts.length,
      remoteOperations: remoteOperations.length,
      since: request.since,
      cursor,
      durationMs: Date.now() - startedAt,
    });

    return { remoteOperations, mergedStates, conflicts, syncedAt, cursor };
  }

  /**
   * With a `since` cursor: every op from another node appended after it.
   * Without one (older clients): ops from other nodes on the entities the
   * client sent, that its snapshot clock has not yet observed.
   */
  private missingOperations(request: CRDTSyncRequest): CRDTOperation[] {
    const fromOthers = (op: CRDTOperation) => op.nodeId !== request.nodeId;

    if (typeof request.since === 'number') {
      return this.log
        .readSince(request.since)
        .flatMap((event) => (event.kind === 'op' && fromOthers(event.op) ? [event.op] : []));
    }

    return request.entityStates.flatMap((clientState) =>
      this.log
        .readEntity(clientState.entityId)
        .flatMap((event) =>
          event.kind === 'op' &&
          fromOthers(event.op) &&
          (event.op.clock[event.op.nodeId] ?? 0) > (clientState.clock[event.op.nodeId] ?? 0)
            ? [event.op]
            : [],
        ),
    );
  }
}

export function createSyncEngine(options?: SyncEngineOptions): SyncEngine {
  return new SyncEngine(options);
}

let defaultEngine: SyncEngine | undefined;

function engine(): SyncEngine {
  defaultEngine ??= createSyncEngine();
  return defaultEngine;
}

/** Process a sync request against the process-wide engine. */
export function processSyncRequest(request: CRDTSyncRequest): CRDTSyncResponse {
  return engine().process(request);
}

function validateSyncRequest(body: unknown): CRDTSyncRequest {
  const request = body as Partial<CRDTSyncRequest> | null;
  if (!request || typeof request.nodeId !== 'string' || !request.nodeId || !Array.isArray(request.operations)) {
    throw new InvalidSyncRequestError('Invalid sync request: missing nodeId or operations');
  }
  if (request.entityStates !== undefined && !Array.isArray(request.entityStates)) {
    throw new InvalidSyncRequestError('Invalid sync request: entityStates must be an array');
  }
  if (request.since !== undefined && (!Number.isInteger(request.since) || request.since < 0)) {
    throw new InvalidSyncRequestError('Invalid sync request: since must be a non-negative integer');
  }
  request.operations.forEach((op, index) => {
    const valid =
      op &&
      typeof op.id === 'string' &&
      typeof op.entityId === 'string' &&
      typeof op.field === 'string' &&
      typeof op.nodeId === 'string' &&
      Number.isFinite(op.timestamp) &&
      OP_TYPES.has(op.type) &&
      op.clock !== null &&
      typeof op.clock === 'object';
    if (!valid) throw new InvalidSyncRequestError(`Invalid sync request: malformed operation at index ${index}`);
  });
  return { ...request, entityStates: request.entityStates ?? [] } as CRDTSyncRequest;
}

/**
 * HTTP handler adapter (framework-agnostic).
 * Expects a JSON body matching CRDTSyncRequest; throws InvalidSyncRequestError otherwise.
 */
export async function handleSyncRequest(body: unknown): Promise<CRDTSyncResponse> {
  return processSyncRequest(validateSyncRequest(body));
}
