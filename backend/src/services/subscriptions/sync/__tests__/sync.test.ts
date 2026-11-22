/**
 * Unit tests for the sync module.
 *
 * Covers: errors, the event log, projection, and the engine service facade.
 * No network I/O — the in-memory log is used throughout.
 */

import { SyncError, SyncErrorCode } from '../errors';
import { SyncEngineService } from '../syncEngineService';
import { InMemorySyncEventLog } from '../../../../../sync/eventLog';
import { emptyEntity, applyOperation, mergeEntityStates, replay } from '../../../../../sync/projection';
import type { CRDTSyncRequest, CRDTOperation, EntityCRDTState } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function lwwSetOp(overrides: Partial<CRDTOperation> = {}): CRDTOperation {
  return {
    id: `op_${Math.random().toString(36).slice(2)}`,
    type: 'lww_set',
    entityId: 'entity_1',
    field: 'name',
    payload: 'Alice',
    nodeId: 'node_A',
    timestamp: Date.now(),
    clock: { node_A: 1 },
    ...overrides,
  };
}

function minimalRequest(ops: CRDTOperation[] = [], nodeId = 'node_A'): CRDTSyncRequest {
  return { nodeId, operations: ops, entityStates: [] };
}

// ── Error codes ───────────────────────────────────────────────────────────────

describe('SyncError', () => {
  it('all error codes are unique', () => {
    const codes = Object.values(SyncErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('invalidRequest carries reason', () => {
    const err = SyncError.invalidRequest('missing nodeId');
    expect(err.code).toBe(SyncErrorCode.INVALID_REQUEST);
    expect(err.details.reason).toBe('missing nodeId');
  });

  it('entityNotFound carries entityId', () => {
    const err = SyncError.entityNotFound('e_1');
    expect(err.code).toBe(SyncErrorCode.ENTITY_NOT_FOUND);
    expect(err.details.entityId).toBe('e_1');
  });

  it('conflictUnresolved carries entityId and field', () => {
    const err = SyncError.conflictUnresolved('e_2', 'status');
    expect(err.code).toBe(SyncErrorCode.CONFLICT_UNRESOLVED);
    expect(err.details).toMatchObject({ entityId: 'e_2', field: 'status' });
  });
});

// ── InMemorySyncEventLog ──────────────────────────────────────────────────────

describe('InMemorySyncEventLog', () => {
  it('appends an op and reports it via head()', () => {
    const log = new InMemorySyncEventLog();
    log.append({ kind: 'op', op: lwwSetOp() });
    expect(log.head()).toBe(1);
  });

  it('deduplicates ops with the same id', () => {
    const log = new InMemorySyncEventLog();
    const op = lwwSetOp({ id: 'op_fixed' });
    const first = log.append({ kind: 'op', op });
    const second = log.append({ kind: 'op', op });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(log.head()).toBe(1);
  });

  it('readSince returns events appended after the given seq', () => {
    const log = new InMemorySyncEventLog();
    log.append({ kind: 'op', op: lwwSetOp() });
    log.append({ kind: 'op', op: lwwSetOp() });
    const after = log.readSince(1);
    expect(after).toHaveLength(1);
  });

  it('readEntity returns only events for the requested entity', () => {
    const log = new InMemorySyncEventLog();
    log.append({ kind: 'op', op: lwwSetOp({ entityId: 'e_1' }) });
    log.append({ kind: 'op', op: lwwSetOp({ entityId: 'e_2' }) });
    expect(log.readEntity('e_1')).toHaveLength(1);
    expect(log.readEntity('e_2')).toHaveLength(1);
  });

  it('appends a snapshot event', () => {
    const log = new InMemorySyncEventLog();
    const state: EntityCRDTState = {
      entityId: 'e_1',
      lwwFields: {},
      orSets: {},
      counters: {},
      clock: {},
    };
    const result = log.append({ kind: 'snapshot', nodeId: 'node_A', state });
    expect(result.duplicate).toBe(false);
    expect(log.head()).toBe(1);
  });
});

// ── applyOperation (projection) ───────────────────────────────────────────────

describe('applyOperation', () => {
  it('sets an LWW field', () => {
    const entity = emptyEntity('e_1');
    const updated = applyOperation(entity, lwwSetOp({ payload: 'Bob', clock: { node_A: 1 } }));
    expect(updated.lwwFields['name']?.value).toBe('Bob');
  });

  it('applies pncounter_increment', () => {
    const entity = emptyEntity('e_1');
    const op: CRDTOperation = {
      id: 'op_1',
      type: 'pncounter_increment',
      entityId: 'e_1',
      field: 'views',
      payload: 5,
      nodeId: 'node_A',
      timestamp: Date.now(),
      clock: { node_A: 1 },
    };
    const updated = applyOperation(entity, op);
    expect(updated.counters['views']?.positive['node_A']).toBe(5);
  });

  it('applies orset_add', () => {
    const entity = emptyEntity('e_1');
    const op: CRDTOperation = {
      id: 'op_2',
      type: 'orset_add',
      entityId: 'e_1',
      field: 'tags',
      payload: 'billing',
      nodeId: 'node_A',
      timestamp: Date.now(),
      clock: { node_A: 1 },
    };
    const updated = applyOperation(entity, op);
    expect(updated.orSets['tags']?.added['billing']).toBeDefined();
  });
});

// ── replay (projection) ───────────────────────────────────────────────────────

describe('replay', () => {
  it('rebuilds entity state from a sequence of events', () => {
    const log = new InMemorySyncEventLog();
    log.append({ kind: 'op', op: lwwSetOp({ payload: 'v1', clock: { node_A: 1 } }) });
    log.append({ kind: 'op', op: lwwSetOp({ id: 'op_2', payload: 'v2', clock: { node_A: 2 } }) });

    const events = log.readEntity('entity_1');
    const state = replay('entity_1', events);
    expect(state.lwwFields['name']?.value).toBe('v2');
  });

  it('returns an empty entity when there are no events', () => {
    const state = replay('e_x', []);
    expect(state).toStrictEqual(emptyEntity('e_x'));
  });
});

// ── mergeEntityStates ─────────────────────────────────────────────────────────

describe('mergeEntityStates', () => {
  it('server wins on a concurrent LWW conflict (higher timestamp)', () => {
    const server = emptyEntity('e_1');
    const client = emptyEntity('e_1');

    const serverState = applyOperation(server, lwwSetOp({ payload: 'server_value', timestamp: 200, clock: { node_A: 2 } }));
    const clientState = applyOperation(client, lwwSetOp({ payload: 'client_value', timestamp: 100, clock: { node_B: 1 } }));

    const merged = mergeEntityStates(serverState, clientState);
    // LWW: higher timestamp wins
    expect(merged.lwwFields['name']?.value).toBe('server_value');
  });
});

// ── SyncEngineService ─────────────────────────────────────────────────────────

describe('SyncEngineService', () => {
  it('processes a valid sync request and returns a response', () => {
    const service = new SyncEngineService();
    const op = lwwSetOp();
    const response = service.process(minimalRequest([op]));
    expect(response).toBeDefined();
    expect(response.syncedAt).toBeDefined();
    expect(response.cursor).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(response.conflicts)).toBe(true);
    expect(Array.isArray(response.remoteOperations)).toBe(true);
  });

  it('throws SyncError for a request missing nodeId', () => {
    const service = new SyncEngineService();
    const badRequest = { nodeId: '', operations: [] } as unknown as CRDTSyncRequest;
    expect(() => service.process(badRequest)).toThrow(SyncError);
    expect(() => service.process(badRequest)).toThrow(
      expect.objectContaining({ code: SyncErrorCode.INVALID_REQUEST }),
    );
  });

  it('deduplicates operations with the same id', () => {
    const service = new SyncEngineService();
    const op = lwwSetOp({ id: 'op_stable' });
    service.process(minimalRequest([op]));
    const response = service.process(minimalRequest([op]));
    // The op was already applied; stats should show it as a duplicate
    const stats = service.stats();
    expect(stats.duplicateOps).toBeGreaterThanOrEqual(1);
  });

  it('getEntity returns the current projected state', () => {
    const service = new SyncEngineService();
    const op = lwwSetOp({ payload: 'subscription_active' });
    service.process(minimalRequest([op]));
    const state = service.getEntity('entity_1');
    expect(state.entityId).toBe('entity_1');
    expect(state.lwwFields['name']?.value).toBe('subscription_active');
  });

  it('accumulates stats across multiple requests', () => {
    const service = new SyncEngineService();
    service.process(minimalRequest([lwwSetOp()]));
    service.process(minimalRequest([lwwSetOp()]));
    expect(service.stats().requests).toBe(2);
    expect(service.stats().opsApplied).toBeGreaterThanOrEqual(2);
  });

  it('reports conflicts when two nodes set the same field concurrently', () => {
    const log = new InMemorySyncEventLog();
    const service = new SyncEngineService({ log });

    // node_A sets at clock {node_A:1}
    service.process({
      nodeId: 'node_A',
      operations: [lwwSetOp({ id: 'op_A', payload: 'from_A', nodeId: 'node_A', clock: { node_A: 1 } })],
      entityStates: [],
    });

    // node_B sets the same field at a concurrent clock — {node_B:1} vs {node_A:1}
    const response = service.process({
      nodeId: 'node_B',
      operations: [
        lwwSetOp({ id: 'op_B', payload: 'from_B', nodeId: 'node_B', clock: { node_B: 1 }, timestamp: Date.now() + 1 }),
      ],
      entityStates: [],
    });

    // LWW resolves it, but we should see it in the conflicts array
    expect(response.conflicts).toHaveLength(1);
  });
});
