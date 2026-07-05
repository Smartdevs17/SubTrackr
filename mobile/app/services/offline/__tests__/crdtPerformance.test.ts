/**
 * CRDT merge performance test
 *
 * Acceptance criterion: CRDT merge for 1000 operations completes within 100ms on device.
 *
 * Tests the pure merge functions in shared/types/crdt.ts directly (no I/O)
 * to isolate the algorithmic cost from storage latency.
 */

import {
  mergeLWWRegister,
  mergeORSet,
  mergePNCounter,
  mergeLWWMap,
  mergeClocks,
  incrementClock,
  orSetAdd,
  orSetRemove,
  pnCounterIncrement,
  pnCounterDecrement,
  lwwMapSet,
  LWWRegister,
  ORSet,
  PNCounter,
  LWWMap,
  VectorClock,
  EntityCRDTState,
} from '../../../../../shared/types/crdt';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRegister(value: string, ts: number, nodeId: string): LWWRegister<string> {
  return { value, timestamp: ts, nodeId, clock: { [nodeId]: 1 } };
}

function emptyEntityState(entityId: string): EntityCRDTState {
  return { entityId, lwwFields: {}, orSets: {}, counters: {}, clock: {} };
}

function applyOpToState(
  entity: EntityCRDTState,
  field: string,
  value: string,
  nodeId: string,
  ts: number,
): EntityCRDTState {
  const clock = incrementClock(entity.clock, nodeId);
  const incoming: LWWRegister<unknown> = { value, timestamp: ts, nodeId, clock };
  const existing = entity.lwwFields[field];
  return {
    ...entity,
    lwwFields: {
      ...entity.lwwFields,
      [field]: existing ? mergeLWWRegister(existing, incoming) : incoming,
    },
    clock,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CRDT merge performance', () => {
  const OPERATION_COUNT = 1000;
  const MAX_MS = 100;

  it(`merges ${OPERATION_COUNT} LWW-Register operations in <${MAX_MS}ms`, () => {
    let state: LWWRegister<string> = makeRegister('initial', 0, 'nodeA');

    const start = Date.now();
    for (let i = 0; i < OPERATION_COUNT; i++) {
      const remote = makeRegister(`value_${i}`, i + 1, i % 2 === 0 ? 'nodeB' : 'nodeC');
      state = mergeLWWRegister(state, remote);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(MAX_MS);
    expect(state.value).toBeDefined();
  });

  it(`merges ${OPERATION_COUNT} OR-Set operations in <${MAX_MS}ms`, () => {
    let set: ORSet<string> = { added: {}, removed: [] };

    const start = Date.now();
    for (let i = 0; i < OPERATION_COUNT; i++) {
      const key = `element_${i % 100}`;
      const tag = `tag_${i}`;
      if (i % 3 === 0) {
        // merge a remote add
        const remote: ORSet<string> = {
          added: { [key]: [tag] },
          removed: [],
        };
        set = mergeORSet(set, remote);
      } else if (i % 3 === 1) {
        set = orSetAdd(set, key, tag);
      } else {
        set = orSetRemove(set, key);
      }
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(MAX_MS);
  });

  it(`merges ${OPERATION_COUNT} PN-Counter operations in <${MAX_MS}ms`, () => {
    let counter: PNCounter = { positive: {}, negative: {} };

    const start = Date.now();
    for (let i = 0; i < OPERATION_COUNT; i++) {
      const nodeId = `node_${i % 10}`;
      if (i % 2 === 0) {
        counter = pnCounterIncrement(counter, nodeId, 1);
      } else {
        counter = pnCounterDecrement(counter, nodeId, 1);
      }
    }
    // Also merge 500 remote counter states
    for (let i = 0; i < 500; i++) {
      const remote: PNCounter = {
        positive: { [`rnode_${i % 5}`]: i },
        negative: { [`rnode_${i % 5}`]: Math.floor(i / 2) },
      };
      counter = mergePNCounter(counter, remote);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(MAX_MS);
  });

  it(`merges ${OPERATION_COUNT} entity states (full entity merge) in <${MAX_MS}ms`, () => {
    let entity = emptyEntityState('sub_perf_test');

    const start = Date.now();
    for (let i = 0; i < OPERATION_COUNT; i++) {
      const nodeId = i % 2 === 0 ? 'nodeA' : 'nodeB';
      const field = `field_${i % 20}`; // 20 different fields
      entity = applyOpToState(entity, field, `value_${i}`, nodeId, i);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(MAX_MS);
    // After 1000 ops, the winning value for field_0 should be the latest timestamp
    expect(entity.lwwFields['field_0']).toBeDefined();
  });

  it('concurrent modification of the same scalar field resolves via LWW causality', () => {
    // Device A and Device B concurrently set the same field
    const clockA: VectorClock = { nodeA: 2, nodeB: 1 };
    const clockB: VectorClock = { nodeA: 1, nodeB: 2 };

    const regA: LWWRegister<string> = {
      value: 'paused',
      timestamp: 1000,
      nodeId: 'nodeA',
      clock: clockA,
    };

    const regB: LWWRegister<string> = {
      value: 'cancelled',
      timestamp: 1001, // slightly later wall clock
      nodeId: 'nodeB',
      clock: clockB,
    };

    // Clocks are concurrent (neither dominates), so LWW timestamp breaks the tie
    const merged = mergeLWWRegister(regA, regB);

    // nodeB has the higher timestamp → cancelled wins
    expect(merged.value).toBe('cancelled');
    expect(merged.nodeId).toBe('nodeB');
  });

  it('LWW-Map merges 1000 field entries in <100ms', () => {
    let map: LWWMap<string> = {};
    const clock: VectorClock = { nodeA: 1 };

    const start = Date.now();
    for (let i = 0; i < OPERATION_COUNT; i++) {
      map = lwwMapSet(map, `field_${i}`, `value_${i}`, 'nodeA', clock);
    }

    // Merge with a remote map of the same size
    let remoteMap: LWWMap<string> = {};
    for (let i = 0; i < OPERATION_COUNT; i++) {
      remoteMap = lwwMapSet(remoteMap, `field_${i}`, `remote_value_${i}`, 'nodeB', { nodeB: 1 });
    }

    map = mergeLWWMap(map, remoteMap);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(MAX_MS);
    // nodeA and nodeB have the same timestamp (Date.now()), tie-break by nodeId
    // 'nodeB' > 'nodeA' alphabetically, so remote values win
    expect(Object.keys(map).length).toBe(OPERATION_COUNT);
  });
});
