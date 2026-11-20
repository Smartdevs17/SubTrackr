/**
 * Pure CRDT projection: folds sync events into entity state.
 *
 * `applyOperation` and `mergeEntityStates` are the reducers. `EntityProjection`
 * caches the folded state per entity and only applies events it has not seen,
 * so reads stay cheap while the event log remains the source of truth.
 */

import {
  CRDTOperation,
  EntityCRDTState,
  CRDTConflict,
  LWWMap,
  ORSet,
  PNCounter,
  mergeClocks,
  compareClocks,
  mergeLWWRegister,
  mergeORSet,
  mergePNCounter,
} from '../../shared/types/crdt';
import type { SyncEvent, SyncEventLog } from './eventLog';

export function emptyEntity(entityId: string): EntityCRDTState {
  return { entityId, lwwFields: {}, orSets: {}, counters: {}, clock: {} };
}

export function applyOperation(
  entity: EntityCRDTState,
  op: CRDTOperation,
  conflicts: CRDTConflict[] = [],
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
      const set: ORSet = updated.orSets[op.field] ?? { added: {}, removed: [] };
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
      const set: ORSet = updated.orSets[op.field] ?? { added: {}, removed: [] };
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

export function mergeEntityStates(
  server: EntityCRDTState,
  client: EntityCRDTState,
  conflicts: CRDTConflict[] = [],
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
  const orSets: Record<string, ORSet> = { ...server.orSets };
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

/** Applies one log event to a state. Conflicts are reported through `conflicts`. */
export function applyEvent(
  state: EntityCRDTState,
  event: SyncEvent,
  conflicts: CRDTConflict[] = [],
): EntityCRDTState {
  if (event.kind === 'op') {
    const updated = applyOperation(state, event.op, conflicts);
    return { ...updated, clock: mergeClocks(updated.clock, event.op.clock) };
  }
  return mergeEntityStates(state, event.state, conflicts);
}

/** Rebuilds an entity from scratch by replaying its events. */
export function replay(entityId: string, events: SyncEvent[]): EntityCRDTState {
  return events.reduce((state, event) => applyEvent(state, event), emptyEntity(entityId));
}

export class EntityProjection {
  private readonly cache = new Map<string, { state: EntityCRDTState; seq: number }>();

  constructor(private readonly log: SyncEventLog) {}

  /**
   * Current state of an entity. Events after the cached position are applied
   * in order; conflicts they raise are pushed onto `conflicts`.
   */
  get(entityId: string, conflicts: CRDTConflict[] = []): EntityCRDTState {
    const cached = this.cache.get(entityId) ?? { state: emptyEntity(entityId), seq: 0 };
    let { state, seq } = cached;
    for (const event of this.log.readEntity(entityId, seq)) {
      state = applyEvent(state, event, conflicts);
      seq = event.seq;
    }
    this.cache.set(entityId, { state, seq });
    return state;
  }

  /** Drops cached state, e.g. after the log is restored from a backup. */
  reset(): void {
    this.cache.clear();
  }
}
