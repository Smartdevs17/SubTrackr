/**
 * CRDT operation type definitions shared between mobile and backend.
 *
 * Implements the following CRDT types:
 *   - LWW-Register  (Last-Writer-Wins scalar field)
 *   - OR-Set        (Observed-Remove set for collections)
 *   - PN-Counter    (increment/decrement counter)
 *   - LWW-Map       (map of LWW-Registers keyed by string)
 *
 * Vector clocks track causality per entity so concurrent edits to the same
 * scalar field can be resolved deterministically rather than silently dropped.
 */

// ── Vector clock ─────────────────────────────────────────────────────────────

/**
 * A vector clock maps node/device IDs to their logical timestamps.
 * Each device increments only its own counter on every mutation.
 */
export type VectorClock = Record<string, number>;

/**
 * Comparison result between two vector clocks.
 *   - 'before'       : a happened-before b
 *   - 'after'        : a happened-after  b
 *   - 'concurrent'   : neither dominates the other
 *   - 'equal'        : identical clocks
 */
export type ClockRelation = 'before' | 'after' | 'concurrent' | 'equal';

/** Compare two vector clocks and return their causal relationship. */
export function compareClocks(a: VectorClock, b: VectorClock): ClockRelation {
  const nodes = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aLessB = false;
  let bLessA = false;

  for (const node of nodes) {
    const av = a[node] ?? 0;
    const bv = b[node] ?? 0;
    if (av < bv) aLessB = true;
    if (bv < av) bLessA = true;
  }

  if (!aLessB && !bLessA) return 'equal';
  if (aLessB && !bLessA) return 'before';
  if (bLessA && !aLessB) return 'after';
  return 'concurrent';
}

/** Merge two vector clocks by taking the component-wise maximum. */
export function mergeClocks(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = { ...a };
  for (const [node, ts] of Object.entries(b)) {
    result[node] = Math.max(result[node] ?? 0, ts);
  }
  return result;
}

/** Increment the local node's counter in a vector clock. */
export function incrementClock(clock: VectorClock, nodeId: string): VectorClock {
  return { ...clock, [nodeId]: (clock[nodeId] ?? 0) + 1 };
}

// ── LWW-Register ─────────────────────────────────────────────────────────────

/**
 * A Last-Writer-Wins register for a single scalar value.
 * The write with the highest wall-clock timestamp wins on conflict.
 * Wall-clock ties are broken by the nodeId string comparison (deterministic).
 */
export interface LWWRegister<T> {
  value: T;
  /** Wall-clock timestamp (ms since epoch) of the last write. */
  timestamp: number;
  /** ID of the node that performed the last write. */
  nodeId: string;
  /** Causality information at the time of write. */
  clock: VectorClock;
}

/** Merge two LWW-Registers: the one with the later timestamp wins. */
export function mergeLWWRegister<T>(local: LWWRegister<T>, remote: LWWRegister<T>): LWWRegister<T> {
  if (remote.timestamp > local.timestamp) return remote;
  if (remote.timestamp < local.timestamp) return local;
  // Tie-break by nodeId for determinism
  return remote.nodeId > local.nodeId ? remote : local;
}

// ── OR-Set ────────────────────────────────────────────────────────────────────

/**
 * An Observed-Remove Set (OR-Set).
 * Each element has a unique tag (UUID) to distinguish concurrent add/remove.
 * An element is in the set if any of its tags are in `added` but not in `removed`.
 */
export interface ORSet {
  /** Map from element key (serialised) to a set of unique add-tags. */
  added: Record<string, string[]>;
  /** Set of removed tags. */
  removed: string[];
}

/** Add an element to an OR-Set, generating a unique tag. */
export function orSetAdd(set: ORSet, key: string, tag: string): ORSet {
  const existing = set.added[key] ?? [];
  return {
    ...set,
    added: { ...set.added, [key]: [...existing, tag] },
  };
}

/** Remove an element from an OR-Set by marking all its current tags as removed. */
export function orSetRemove(set: ORSet, key: string): ORSet {
  const tags = set.added[key] ?? [];
  return {
    ...set,
    removed: [...set.removed, ...tags],
  };
}

/** Check whether an element is in the OR-Set. */
export function orSetContains(set: ORSet, key: string): boolean {
  const tags = set.added[key] ?? [];
  return tags.some((tag) => !set.removed.includes(tag));
}

/** Return all keys currently in the OR-Set. */
export function orSetValues(set: ORSet): string[] {
  return Object.keys(set.added).filter((key) => orSetContains(set, key));
}

/** Merge two OR-Sets: union of added tags, union of removed tags. */
export function mergeORSet(local: ORSet, remote: ORSet): ORSet {
  const mergedAdded: Record<string, string[]> = { ...local.added };
  for (const [key, tags] of Object.entries(remote.added)) {
    const localTags = mergedAdded[key] ?? [];
    const combined = Array.from(new Set([...localTags, ...tags]));
    mergedAdded[key] = combined;
  }
  const mergedRemoved = Array.from(new Set([...local.removed, ...remote.removed]));
  return { added: mergedAdded, removed: mergedRemoved };
}

// ── PN-Counter ────────────────────────────────────────────────────────────────

/**
 * A PN-Counter (Positive-Negative Counter).
 * Each node maintains its own increment and decrement GCounters.
 */
export interface PNCounter {
  /** Increments per node. */
  positive: Record<string, number>;
  /** Decrements per node. */
  negative: Record<string, number>;
}

/** Return the effective value of a PN-Counter. */
export function pnCounterValue(counter: PNCounter): number {
  const pos = Object.values(counter.positive).reduce((a, b) => a + b, 0);
  const neg = Object.values(counter.negative).reduce((a, b) => a + b, 0);
  return pos - neg;
}

/** Increment a PN-Counter for a given node. */
export function pnCounterIncrement(counter: PNCounter, nodeId: string, amount = 1): PNCounter {
  return {
    ...counter,
    positive: { ...counter.positive, [nodeId]: (counter.positive[nodeId] ?? 0) + amount },
  };
}

/** Decrement a PN-Counter for a given node. */
export function pnCounterDecrement(counter: PNCounter, nodeId: string, amount = 1): PNCounter {
  return {
    ...counter,
    negative: { ...counter.negative, [nodeId]: (counter.negative[nodeId] ?? 0) + amount },
  };
}

/** Merge two PN-Counters by taking component-wise maxima. */
export function mergePNCounter(local: PNCounter, remote: PNCounter): PNCounter {
  const positive: Record<string, number> = { ...local.positive };
  for (const [node, val] of Object.entries(remote.positive)) {
    positive[node] = Math.max(positive[node] ?? 0, val);
  }
  const negative: Record<string, number> = { ...local.negative };
  for (const [node, val] of Object.entries(remote.negative)) {
    negative[node] = Math.max(negative[node] ?? 0, val);
  }
  return { positive, negative };
}

// ── LWW-Map ───────────────────────────────────────────────────────────────────

/**
 * A map of LWW-Registers keyed by string.
 * Useful for applying CRDT semantics to arbitrary named fields.
 */
export type LWWMap<T> = Record<string, LWWRegister<T>>;

/** Set a key in an LWW-Map. */
export function lwwMapSet<T>(
  map: LWWMap<T>,
  key: string,
  value: T,
  nodeId: string,
  clock: VectorClock
): LWWMap<T> {
  return {
    ...map,
    [key]: { value, timestamp: Date.now(), nodeId, clock },
  };
}

/** Merge two LWW-Maps key-by-key. */
export function mergeLWWMap<T>(local: LWWMap<T>, remote: LWWMap<T>): LWWMap<T> {
  const result: LWWMap<T> = { ...local };
  for (const [key, remoteReg] of Object.entries(remote)) {
    const localReg = result[key];
    result[key] = localReg ? mergeLWWRegister(localReg, remoteReg) : remoteReg;
  }
  return result;
}

// ── CRDT Operation envelope ───────────────────────────────────────────────────

export type CRDTOpType =
  | 'lww_set'
  | 'orset_add'
  | 'orset_remove'
  | 'pncounter_increment'
  | 'pncounter_decrement';

/**
 * A single CRDT operation ready to be queued offline and replayed on sync.
 */
export interface CRDTOperation {
  /** Unique ID for this operation. */
  id: string;
  /** The entity this operation targets (e.g. subscription ID). */
  entityId: string;
  /** The field or collection name within the entity. */
  field: string;
  /** CRDT operation type. */
  type: CRDTOpType;
  /** Serialised payload — the new value for lww_set, element key for sets, etc. */
  payload: unknown;
  /** Unique tag used by OR-Set operations. */
  tag?: string;
  /** Node (device) that generated this operation. */
  nodeId: string;
  /** Wall-clock timestamp at creation (ms since epoch). */
  timestamp: number;
  /** Vector clock at the time of the operation. */
  clock: VectorClock;
}

/**
 * The full CRDT state for a single entity, keyed by field name.
 */
export interface EntityCRDTState {
  entityId: string;
  /** LWW scalar fields. */
  lwwFields: LWWMap<unknown>;
  /** OR-Set collections (keyed by field name). */
  orSets: Record<string, ORSet>;
  /** PN-Counters (keyed by field name). */
  counters: Record<string, PNCounter>;
  /** Merged vector clock across all fields. */
  clock: VectorClock;
  /** ISO timestamp of last sync with server. */
  lastSyncedAt?: string;
}

/**
 * Conflict descriptor emitted when two concurrent writes cannot be
 * automatically resolved (e.g. two devices concurrently set different values
 * with the same timestamp and identical nodeIds — practically impossible but
 * surfaced for the user if needed).
 */
export interface CRDTConflict {
  entityId: string;
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  localTimestamp: number;
  remoteTimestamp: number;
  resolvedValue: unknown;
  resolvedBy: 'lww' | 'user';
}

/**
 * Payload sent to the server sync endpoint.
 */
export interface CRDTSyncRequest {
  nodeId: string;
  operations: CRDTOperation[];
  /** Local CRDT state for entities that have pending operations. */
  entityStates: EntityCRDTState[];
}

/**
 * Response from the server sync endpoint.
 */
export interface CRDTSyncResponse {
  /** Operations the server has that the client doesn't. */
  remoteOperations: CRDTOperation[];
  /** Server-merged entity states. */
  mergedStates: EntityCRDTState[];
  /** Conflicts detected during server-side merge. */
  conflicts: CRDTConflict[];
  /** ISO timestamp of the sync. */
  syncedAt: string;
}
