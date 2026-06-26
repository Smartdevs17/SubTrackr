/**
 * Server-side CRDT merge service.
 *
 * Receives batches of CRDTOperations from clients, applies them to
 * the server-authoritative entity states, detects conflicts, and returns
 * the merged state so the client can converge.
 *
 * In a production system the entity states would be persisted to a database.
 * Here we use an in-memory store to keep the implementation self-contained
 * and testable; swap `entityStore` for a real persistence layer as needed.
 */

import {
  CRDTOperation,
  CRDTSyncRequest,
  CRDTSyncResponse,
  EntityCRDTState,
  CRDTConflict,
  VectorClock,
  LWWMap,
  ORSet,
  PNCounter,
  mergeClocks,
  compareClocks,
  mergeLWWRegister,
  mergeORSet,
  mergePNCounter,
} from '../../shared/types/crdt';

// ── In-memory entity store (replace with DB in production) ────────────────────

const entityStore = new Map<string, EntityCRDTState>();

function getOrCreateEntity(entityId: string): EntityCRDTState {
  if (!entityStore.has(entityId)) {
    entityStore.set(entityId, {
      entityId,
      lwwFields: {},
      orSets: {},
      counters: {},
      clock: {},
    });
  }
  return entityStore.get(entityId)!;
}

// ── Operation application ─────────────────────────────────────────────────────

function applyOperation(
  entity: EntityCRDTState,
  op: CRDTOperation,
  conflicts: CRDTConflict[],
): EntityCRDTState {
  const updated = { ...entity };

  switch (op.type) {
    case 'lww_set': {
      const existing = updated.lwwFields[op.field];
      const incoming = {
        value: op.payload,
        timestamp: op.timestamp,
        nodeId: op.nodeId,
        clock: op.clock,
      };

      if (existing) {
        const relation = compareClocks(existing.clock, incoming.clock);
        const merged = mergeLWWRegister(existing, incoming);

        // Both concurrent and neither is strictly newer — surface for user review
        if (relation === 'concurrent' && existing.value !== incoming.value) {
          conflicts.push({
            entityId: entity.entityId,
            field: op.field,
            localValue: existing.value,
            remoteValue: incoming.value,
            localTimestamp: existing.timestamp,
            remoteTimestamp: incoming.timestamp,
            resolvedValue: merged.value,
            resolvedBy: 'lww',
          });
        }

        updated.lwwFields = { ...updated.lwwFields, [op.field]: merged };
      } else {
        updated.lwwFields = { ...updated.lwwFields, [op.field]: incoming };
      }
      break;
    }

    case 'orset_add': {
      const set: ORSet<unknown> = updated.orSets[op.field] ?? { added: {}, removed: [] };
      const key = String(op.payload);
      const tag = op.tag ?? `${op.nodeId}-${op.timestamp}`;
      updated.orSets = {
        ...updated.orSets,
        [op.field]: {
          added: { ...set.added, [key]: [...(set.added[key] ?? []), tag] },
          removed: set.removed,
        },
      };
      break;
    }

    case 'orset_remove': {
      const set: ORSet<unknown> = updated.orSets[op.field] ?? { added: {}, removed: [] };
      const key = String(op.payload);
      const tagsToRemove = set.added[key] ?? [];
      updated.orSets = {
        ...updated.orSets,
        [op.field]: { added: set.added, removed: [...set.removed, ...tagsToRemove] },
      };
      break;
    }

    case 'pncounter_increment': {
      const counter: PNCounter = updated.counters[op.field] ?? { positive: {}, negative: {} };
      const amount = typeof op.payload === 'number' ? op.payload : 1;
      updated.counters = {
        ...updated.counters,
        [op.field]: {
          ...counter,
          positive: {
            ...counter.positive,
            [op.nodeId]: (counter.positive[op.nodeId] ?? 0) + amount,
          },
        },
      };
      break;
    }

    case 'pncounter_decrement': {
      const counter: PNCounter = updated.counters[op.field] ?? { positive: {}, negative: {} };
      const amount = typeof op.payload === 'number' ? op.payload : 1;
      updated.counters = {
        ...updated.counters,
        [op.field]: {
          ...counter,
          negative: {
            ...counter.negative,
            [op.nodeId]: (counter.negative[op.nodeId] ?? 0) + amount,
          },
        },
      };
      break;
    }
  }

  return updated;
}

// ── State merge ───────────────────────────────────────────────────────────────

function mergeEntityStates(
  server: EntityCRDTState,
  client: EntityCRDTState,
  conflicts: CRDTConflict[],
): EntityCRDTState {
  // LWW fields
  const lwwFields: LWWMap<unknown> = { ...server.lwwFields };
  for (const [field, remoteReg] of Object.entries(client.lwwFields)) {
    const serverReg = lwwFields[field];
    if (serverReg) {
      const relation = compareClocks(serverReg.clock, remoteReg.clock);
      if (relation === 'concurrent' && serverReg.value !== remoteReg.value) {
        const merged = mergeLWWRegister(serverReg, remoteReg);
        conflicts.push({
          entityId: server.entityId,
          field,
          localValue: serverReg.value,
          remoteValue: remoteReg.value,
          localTimestamp: serverReg.timestamp,
          remoteTimestamp: remoteReg.timestamp,
          resolvedValue: merged.value,
          resolvedBy: 'lww',
        });
        lwwFields[field] = merged;
      } else {
        lwwFields[field] = mergeLWWRegister(serverReg, remoteReg);
      }
    } else {
      lwwFields[field] = remoteReg;
    }
  }

  // OR-Sets
  const orSets: Record<string, ORSet<unknown>> = { ...server.orSets };
  for (const [field, remoteSet] of Object.entries(client.orSets)) {
    const localSet = orSets[field] ?? { added: {}, removed: [] };
    orSets[field] = mergeORSet(localSet, remoteSet);
  }

  // PN-Counters
  const counters: Record<string, PNCounter> = { ...server.counters };
  for (const [field, remoteCounter] of Object.entries(client.counters)) {
    const localCounter = counters[field] ?? { positive: {}, negative: {} };
    counters[field] = mergePNCounter(localCounter, remoteCounter);
  }

  const clock = mergeClocks(server.clock, client.clock);

  return { entityId: server.entityId, lwwFields, orSets, counters, clock };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Process a sync request from a client node.
 *
 * 1. Apply each incoming operation to the server entity state in timestamp order.
 * 2. Merge the client's entity snapshots with the server's.
 * 3. Collect any operations the client is missing (not in the client's clock).
 * 4. Return the merged states + conflicts + missing remote operations.
 */
export function processSyncRequest(request: CRDTSyncRequest): CRDTSyncResponse {
  const conflicts: CRDTConflict[] = [];
  const mergedStates: EntityCRDTState[] = [];

  // Sort operations by timestamp to approximate causal order
  const sortedOps = [...request.operations].sort((a, b) => a.timestamp - b.timestamp);

  // Apply operations to server state
  for (const op of sortedOps) {
    const serverEntity = getOrCreateEntity(op.entityId);
    const updated = applyOperation(serverEntity, op, conflicts);
    updated.clock = mergeClocks(updated.clock, op.clock);
    entityStore.set(op.entityId, updated);
  }

  // Merge client entity snapshots
  for (const clientState of request.entityStates) {
    const serverEntity = getOrCreateEntity(clientState.entityId);
    const merged = mergeEntityStates(serverEntity, clientState, conflicts);
    entityStore.set(clientState.entityId, merged);
    mergedStates.push(merged);
  }

  // Determine which server operations the client doesn't have
  // In a real system these would be fetched from a persistent op log.
  // Here we return the merged states which carry the same information.
  const remoteOperations: CRDTOperation[] = [];

  const syncedAt = new Date().toISOString();

  // Stamp merged states with sync time
  for (const state of mergedStates) {
    state.lastSyncedAt = syncedAt;
  }

  return {
    remoteOperations,
    mergedStates,
    conflicts,
    syncedAt,
  };
}

/**
 * HTTP handler adapter (framework-agnostic).
 * Expects a JSON body matching CRDTSyncRequest.
 */
export async function handleSyncRequest(
  body: unknown,
): Promise<CRDTSyncResponse> {
  const request = body as CRDTSyncRequest;
  if (!request.nodeId || !Array.isArray(request.operations)) {
    throw new Error('Invalid sync request: missing nodeId or operations');
  }
  return processSyncRequest(request);
}
