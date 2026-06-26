/**
 * LWW-Map CRDT implementation.
 *
 * A dictionary where each key is an independent LWW-Register.
 * Useful for applying CRDT semantics to arbitrary named scalar fields
 * within a single entity (e.g. all mutable fields of a Subscription).
 */

import {
  LWWMap,
  LWWRegister,
  VectorClock,
  lwwMapSet,
  mergeLWWMap,
} from '../../../../../shared/types/crdt';

export class LWWMapCRDT<T = unknown> {
  private state: LWWMap<T>;

  constructor() {
    this.state = {};
  }

  /** Set a field value. */
  set(key: string, value: T, nodeId: string, clock: VectorClock): void {
    this.state = lwwMapSet<T>(this.state, key, value, nodeId, clock);
  }

  /** Read a field value. Returns undefined if the key has never been set. */
  get(key: string): T | undefined {
    return this.state[key]?.value;
  }

  /** Read the full register for a key (includes timestamp/clock metadata). */
  getRegister(key: string): LWWRegister<T> | undefined {
    return this.state[key];
  }

  /** List all keys currently in the map. */
  keys(): string[] {
    return Object.keys(this.state);
  }

  /** Read the full map state for serialisation / sync. */
  getState(): LWWMap<T> {
    const copy: LWWMap<T> = {};
    for (const [key, reg] of Object.entries(this.state)) {
      copy[key] = { ...reg };
    }
    return copy;
  }

  /** Merge a remote map state into the local one. */
  merge(remote: LWWMap<T>): void {
    this.state = mergeLWWMap<T>(this.state, remote);
  }

  /** Restore state from a serialised snapshot. */
  static fromState<T>(state: LWWMap<T>): LWWMapCRDT<T> {
    const instance = Object.create(LWWMapCRDT.prototype) as LWWMapCRDT<T>;
    instance.state = {};
    for (const [key, reg] of Object.entries(state)) {
      instance.state[key] = { ...reg };
    }
    return instance;
  }
}
