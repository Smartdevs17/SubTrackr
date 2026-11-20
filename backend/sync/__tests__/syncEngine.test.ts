import type { CRDTOperation, EntityCRDTState } from '../../../shared/types/crdt';
import { pnCounterValue, orSetValues } from '../../../shared/types/crdt';
import { InMemorySyncEventLog } from '../eventLog';
import { replay } from '../projection';
import { InvalidSyncRequestError, SyncEngine, handleSyncRequest } from '../crdtMergeService';

const fixedNow = () => new Date('2026-11-20T12:00:00.000Z');

function op(partial: Partial<CRDTOperation> & Pick<CRDTOperation, 'id' | 'type'>): CRDTOperation {
  return {
    entityId: 'sub-1',
    field: 'name',
    payload: null,
    nodeId: 'phone',
    timestamp: 1,
    clock: { phone: 1 },
    ...partial,
  };
}

function snapshot(partial: Partial<EntityCRDTState> = {}): EntityCRDTState {
  return { entityId: 'sub-1', lwwFields: {}, orSets: {}, counters: {}, clock: {}, ...partial };
}

function newEngine() {
  const logger = { info: jest.fn() };
  return { engine: new SyncEngine({ now: fixedNow, logger }), logger };
}

describe('SyncEngine', () => {
  it('appends ops to the log and projects state from it', () => {
    const { engine } = newEngine();
    engine.process({
      nodeId: 'phone',
      operations: [
        op({ id: 'o1', type: 'lww_set', payload: 'Netflix' }),
        op({ id: 'o2', type: 'pncounter_increment', field: 'views', payload: 2 }),
      ],
      entityStates: [],
    });

    const state = engine.getEntity('sub-1');
    expect(state.lwwFields.name.value).toBe('Netflix');
    expect(pnCounterValue(state.counters.views)).toBe(2);
    expect(engine.log.head()).toBe(2);
  });

  it('applies a retried op only once', () => {
    const { engine } = newEngine();
    const increment = op({ id: 'o1', type: 'pncounter_increment', field: 'views', payload: 5 });
    engine.process({ nodeId: 'phone', operations: [increment], entityStates: [] });
    engine.process({ nodeId: 'phone', operations: [increment], entityStates: [] });

    expect(pnCounterValue(engine.getEntity('sub-1').counters.views)).toBe(5);
    expect(engine.stats()).toMatchObject({ requests: 2, opsApplied: 1, duplicateOps: 1 });
  });

  it('returns ops from other nodes after the client cursor, excluding its own', () => {
    const { engine } = newEngine();
    const first = engine.process({
      nodeId: 'phone',
      operations: [op({ id: 'p1', type: 'lww_set', payload: 'A' })],
      entityStates: [],
    });
    expect(first.cursor).toBe(1);
    expect(first.remoteOperations).toEqual([]);

    engine.process({
      nodeId: 'tablet',
      operations: [op({ id: 't1', type: 'lww_set', payload: 'B', nodeId: 'tablet', clock: { tablet: 1 }, timestamp: 2 })],
      entityStates: [],
    });

    const catchUp = engine.process({ nodeId: 'phone', operations: [], entityStates: [], since: first.cursor });
    expect(catchUp.remoteOperations.map((o) => o.id)).toEqual(['t1']);
    expect(catchUp.cursor).toBe(2);

    const again = engine.process({ nodeId: 'phone', operations: [], entityStates: [], since: catchUp.cursor });
    expect(again.remoteOperations).toEqual([]);
  });

  it('without a cursor, returns ops on sent entities that the client clock has not observed', () => {
    const { engine } = newEngine();
    engine.process({
      nodeId: 'tablet',
      operations: [
        op({ id: 't1', type: 'lww_set', payload: 'B', nodeId: 'tablet', clock: { tablet: 1 } }),
        op({ id: 't2', type: 'lww_set', payload: 'C', nodeId: 'tablet', clock: { tablet: 2 }, timestamp: 2 }),
        op({ id: 'other', type: 'lww_set', entityId: 'sub-2', nodeId: 'tablet', clock: { tablet: 3 }, timestamp: 3 }),
      ],
      entityStates: [],
    });

    const response = engine.process({
      nodeId: 'phone',
      operations: [],
      entityStates: [snapshot({ clock: { tablet: 1 } })],
    });
    expect(response.remoteOperations.map((o) => o.id)).toEqual(['t2']);
  });

  it('reports concurrent LWW writes as conflicts and resolves them deterministically', () => {
    const { engine } = newEngine();
    engine.process({
      nodeId: 'phone',
      operations: [op({ id: 'p1', type: 'lww_set', payload: 'Phone', timestamp: 10, clock: { phone: 1 } })],
      entityStates: [],
    });
    const response = engine.process({
      nodeId: 'tablet',
      operations: [op({ id: 't1', type: 'lww_set', payload: 'Tablet', nodeId: 'tablet', timestamp: 20, clock: { tablet: 1 } })],
      entityStates: [],
    });

    expect(response.conflicts).toHaveLength(1);
    expect(response.conflicts[0]).toMatchObject({ field: 'name', localValue: 'Phone', remoteValue: 'Tablet' });
    expect(engine.getEntity('sub-1').lwwFields.name.value).toBe(response.conflicts[0].resolvedValue);
    expect(engine.stats().conflicts).toBe(1);
  });

  it('records snapshots in the log, merges them and stamps lastSyncedAt', () => {
    const { engine } = newEngine();
    engine.process({
      nodeId: 'phone',
      operations: [op({ id: 'p1', type: 'orset_add', field: 'tags', payload: 'video', tag: 'p-1' })],
      entityStates: [],
    });
    const response = engine.process({
      nodeId: 'tablet',
      operations: [],
      entityStates: [snapshot({ orSets: { tags: { added: { music: ['t-1'] }, removed: [] } }, clock: { tablet: 1 } })],
    });

    const [merged] = response.mergedStates;
    expect(orSetValues(merged.orSets.tags).sort()).toEqual(['music', 'video']);
    expect(merged.clock).toEqual({ phone: 1, tablet: 1 });
    expect(merged.lastSyncedAt).toBe('2026-11-20T12:00:00.000Z');
    expect(engine.log.readEntity('sub-1').map((e) => e.kind)).toEqual(['op', 'snapshot']);
  });

  it('can rebuild any entity by replaying the log', () => {
    const { engine } = newEngine();
    engine.process({
      nodeId: 'phone',
      operations: [
        op({ id: 'a', type: 'orset_add', field: 'tags', payload: 'x', tag: 'a' }),
        op({ id: 'b', type: 'orset_remove', field: 'tags', payload: 'x', timestamp: 2, clock: { phone: 2 } }),
        op({ id: 'c', type: 'pncounter_decrement', field: 'views', payload: 3, timestamp: 3, clock: { phone: 3 } }),
      ],
      entityStates: [],
    });

    const rebuilt = replay('sub-1', engine.log.readEntity('sub-1'));
    expect(rebuilt).toEqual(engine.getEntity('sub-1'));
    expect(orSetValues(rebuilt.orSets.tags)).toEqual([]);
    expect(pnCounterValue(rebuilt.counters.views)).toBe(-3);
  });

  it('logs one structured line per request', () => {
    const { engine, logger } = newEngine();
    engine.process({ nodeId: 'phone', operations: [op({ id: 'o1', type: 'lww_set' })], entityStates: [], since: 0 });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      'sync.processed',
      expect.objectContaining({ nodeId: 'phone', opsApplied: 1, duplicateOps: 0, cursor: 1, since: 0 }),
    );
  });
});

describe('InMemorySyncEventLog', () => {
  it('stores copies so later caller mutations cannot rewrite history', () => {
    const log = new InMemorySyncEventLog(fixedNow);
    const original = op({ id: 'o1', type: 'lww_set', payload: 'A' });
    log.append({ kind: 'op', op: original });
    original.payload = 'mutated';
    const [event] = log.readSince(0);
    expect(event.kind === 'op' && event.op.payload).toBe('A');
    expect(event.recordedAt).toBe('2026-11-20T12:00:00.000Z');
  });
});

describe('handleSyncRequest', () => {
  it.each([
    ['null body', null],
    ['missing nodeId', { operations: [] }],
    ['operations not an array', { nodeId: 'n', operations: {} }],
    ['entityStates not an array', { nodeId: 'n', operations: [], entityStates: 'x' }],
    ['negative since', { nodeId: 'n', operations: [], since: -1 }],
    ['unknown op type', { nodeId: 'n', operations: [{ ...op({ id: 'o', type: 'lww_set' }), type: 'drop_table' }] }],
    ['op without id', { nodeId: 'n', operations: [{ ...op({ id: 'o', type: 'lww_set' }), id: undefined }] }],
  ])('rejects %s', async (_label, body) => {
    await expect(handleSyncRequest(body)).rejects.toBeInstanceOf(InvalidSyncRequestError);
  });

  it('accepts a request without entityStates', async () => {
    const response = await handleSyncRequest({ nodeId: 'n', operations: [] });
    expect(response.mergedStates).toEqual([]);
    expect(typeof response.cursor).toBe('number');
  });
});
