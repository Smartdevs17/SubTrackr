/**
 * CRDT Service Layer
 *
 * Manages per-entity CRDT state, applies incoming operations, and coordinates
 * sync with the backend merge endpoint.  All state is persisted via AsyncStorage
 * so it survives app restarts.
 *
 * Usage:
 *   const svc = CRDTService.getInstance();
 *   svc.applyOperation(op);          // queue an offline mutation
 *   await svc.sync(apiEndpoint);     // called on connectivity restore
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CRDTOperation,
  CRDTOpType,
  EntityCRDTState,
  CRDTConflict,
  CRDTSyncRequest,
  CRDTSyncResponse,
  VectorClock,
  LWWMap,
  ORSet,
  PNCounter,
  compareClocks,
  mergeClocks,
  incrementClock,
  mergeLWWMap,
  mergeORSet,
  mergePNCounter,
  mergeLWWRegister,
} from '../../../../shared/types/crdt';

const STORAGE_KEY = 'subtrackr-crdt-state';
const PENDING_OPS_KEY = 'subtrackr-crdt-pending-ops';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CRDTServiceState {
  nodeId: string;
  entities: Record<string, EntityCRDTState>;
  pendingOperations: CRDTOperation[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `crdt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function emptyEntityState(entityId: string): EntityCRDTState {
  return {
    entityId,
    lwwFields: {},
    orSets: {},
    counters: {},
    clock: {},
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class CRDTService {
  private static instance: CRDTService | null = null;

  private nodeId: string;
  private entities: Map<string, EntityCRDTState> = new Map();
  private pendingOperations: CRDTOperation[] = [];
  private initialized = false;

  private constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  static getInstance(nodeId?: string): CRDTService {
    if (!CRDTService.instance) {
      if (!nodeId) throw new Error('nodeId required on first call to CRDTService.getInstance');
      CRDTService.instance = new CRDTService(nodeId);
    }
    return CRDTService.instance;
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const [rawState, rawOps] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(PENDING_OPS_KEY),
      ]);

      if (rawState) {
        const saved = JSON.parse(rawState) as Record<string, EntityCRDTState>;
        for (const [id, state] of Object.entries(saved)) {
          this.entities.set(id, state);
        }
      }

      if (rawOps) {
        this.pendingOperations = JSON.parse(rawOps) as CRDTOperation[];
      }

      this.initialized = true;
    } catch {
      // Storage read failure — start fresh
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    try {
      const entityObj: Record<string, EntityCRDTState> = {};
      for (const [id, state] of this.entities.entries()) {
        entityObj[id] = state;
      }
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entityObj)),
        AsyncStorage.setItem(PENDING_OPS_KEY, JSON.stringify(this.pendingOperations)),
      ]);
    } catch {
      // Non-fatal — will retry on next mutation
    }
  }

  // ── Migration ─────────────────────────────────────────────────────────────

  /**
   * Migrate legacy flat-object records into CRDT entity states.
   * Called once on first sync if no CRDT state exists for the entity.
   */
  migrateEntity(entityId: string, legacyFields: Record<string, unknown>): EntityCRDTState {
    const existing = this.entities.get(entityId);
    if (existing) return existing;

    const lwwFields: LWWMap<unknown> = {};
    for (const [field, value] of Object.entries(legacyFields)) {
      lwwFields[field] = {
        value,
        timestamp: 0, // oldest possible — any incoming write wins
        nodeId: 'migration',
        clock: {},
      };
    }

    const state: EntityCRDTState = {
      entityId,
      lwwFields,
      orSets: {},
      counters: {},
      clock: {},
    };
    this.entities.set(entityId, state);
    return state;
  }

  // ── Applying operations ───────────────────────────────────────────────────

  /**
   * Apply a CRDT operation locally and queue it for sync.
   * Returns the resulting entity state.
   */
  applyOperation(params: {
    entityId: string;
    field: string;
    type: CRDTOpType;
    payload: unknown;
    tag?: string;
  }): EntityCRDTState {
    const entity = this.entities.get(params.entityId) ?? emptyEntityState(params.entityId);
    const newClock = incrementClock(entity.clock, this.nodeId);

    const op: CRDTOperation = {
      id: generateId(),
      entityId: params.entityId,
      field: params.field,
      type: params.type,
      payload: params.payload,
      tag: params.tag ?? generateId(),
      nodeId: this.nodeId,
      timestamp: Date.now(),
      clock: newClock,
    };

    const updatedEntity = this.applyOpToState(entity, op);
    updatedEntity.clock = newClock;
    this.entities.set(params.entityId, updatedEntity);
    this.pendingOperations.push(op);

    void this.persist();
    return updatedEntity;
  }

  /** Set a scalar field via LWW-Register. */
  setField(entityId: string, field: string, value: unknown): EntityCRDTState {
    return this.applyOperation({ entityId, field, type: 'lww_set', payload: value });
  }

  /** Add an element to an OR-Set collection. */
  setAdd(entityId: string, field: string, element: string): EntityCRDTState {
    return this.applyOperation({
      entityId,
      field,
      type: 'orset_add',
      payload: element,
      tag: generateId(),
    });
  }

  /** Remove an element from an OR-Set collection. */
  setRemove(entityId: string, field: string, element: string): EntityCRDTState {
    return this.applyOperation({ entityId, field, type: 'orset_remove', payload: element });
  }

  /** Increment a PN-Counter field. */
  counterIncrement(entityId: string, field: string, amount = 1): EntityCRDTState {
    return this.applyOperation({ entityId, field, type: 'pncounter_increment', payload: amount });
  }

  /** Decrement a PN-Counter field. */
  counterDecrement(entityId: string, field: string, amount = 1): EntityCRDTState {
    return this.applyOperation({ entityId, field, type: 'pncounter_decrement', payload: amount });
  }

  // ── Reading state ─────────────────────────────────────────────────────────

  getEntity(entityId: string): EntityCRDTState | undefined {
    return this.entities.get(entityId);
  }

  getFieldValue(entityId: string, field: string): unknown {
    return this.entities.get(entityId)?.lwwFields[field]?.value;
  }

  getPendingOperations(): CRDTOperation[] {
    return [...this.pendingOperations];
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  /**
   * Sync pending operations with the server.
   * Merges server state locally and resolves conflicts.
   * Returns any conflicts that require user review.
   */
  async sync(endpoint: string): Promise<CRDTConflict[]> {
    await this.initialize();
    if (this.pendingOperations.length === 0) return [];

    const entityIds = [...new Set(this.pendingOperations.map((op) => op.entityId))];
    const entityStates = entityIds
      .map((id) => this.entities.get(id))
      .filter((s): s is EntityCRDTState => s !== undefined);

    const request: CRDTSyncRequest = {
      nodeId: this.nodeId,
      operations: [...this.pendingOperations],
      entityStates,
    };

    let response: CRDTSyncResponse;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      response = (await res.json()) as CRDTSyncResponse;
    } catch (err) {
      // Network failure — keep ops queued for next attempt
      throw err;
    }

    // Apply remote operations
    for (const remoteOp of response.remoteOperations) {
      const entity = this.entities.get(remoteOp.entityId) ?? emptyEntityState(remoteOp.entityId);
      const updated = this.applyOpToState(entity, remoteOp);
      updated.clock = mergeClocks(updated.clock, remoteOp.clock);
      this.entities.set(remoteOp.entityId, updated);
    }

    // Apply server-merged entity states (authoritative)
    for (const serverState of response.mergedStates) {
      const local = this.entities.get(serverState.entityId) ?? emptyEntityState(serverState.entityId);
      const merged = this.mergeEntityStates(local, serverState);
      merged.lastSyncedAt = response.syncedAt;
      this.entities.set(serverState.entityId, merged);
    }

    // Clear synced operations
    this.pendingOperations = [];
    await this.persist();

    return response.conflicts;
  }

  // ── Internal merge ────────────────────────────────────────────────────────

  private applyOpToState(entity: EntityCRDTState, op: CRDTOperation): EntityCRDTState {
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
        updated.lwwFields = {
          ...updated.lwwFields,
          [op.field]: existing ? mergeLWWRegister(existing, incoming) : incoming,
        };
        break;
      }

      case 'orset_add': {
        const set: ORSet<unknown> = updated.orSets[op.field] ?? { added: {}, removed: [] };
        const key = String(op.payload);
        const tag = op.tag ?? generateId();
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
          [op.field]: {
            added: set.added,
            removed: [...set.removed, ...tagsToRemove],
          },
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

  private mergeEntityStates(
    local: EntityCRDTState,
    remote: EntityCRDTState,
  ): EntityCRDTState {
    const lwwFields = mergeLWWMap(local.lwwFields, remote.lwwFields);

    const orSets: Record<string, ORSet<unknown>> = { ...local.orSets };
    for (const [field, remoteSet] of Object.entries(remote.orSets)) {
      const localSet = orSets[field] ?? { added: {}, removed: [] };
      orSets[field] = mergeORSet(localSet, remoteSet);
    }

    const counters: Record<string, PNCounter> = { ...local.counters };
    for (const [field, remoteCounter] of Object.entries(remote.counters)) {
      const localCounter = counters[field] ?? { positive: {}, negative: {} };
      counters[field] = mergePNCounter(localCounter, remoteCounter);
    }

    const clock = mergeClocks(local.clock, remote.clock);

    return {
      entityId: local.entityId,
      lwwFields,
      orSets,
      counters,
      clock,
      lastSyncedAt: remote.lastSyncedAt ?? local.lastSyncedAt,
    };
  }
}

export default CRDTService;
