/**
 * OR-Set (Observed-Remove Set) CRDT implementation.
 *
 * Each element in the set is tagged with a unique ID when added.
 * Removal marks all currently known tags as removed.
 * An element is considered present if it has at least one live (non-removed) tag.
 * This means add always wins over a concurrent remove that it didn't observe.
 */

import {
  ORSet,
  orSetAdd,
  orSetRemove,
  orSetContains,
  orSetValues,
  mergeORSet,
} from '../../../../../shared/types/crdt';

let tagCounter = 0;

function generateTag(nodeId: string): string {
  tagCounter += 1;
  return `${nodeId}-${Date.now()}-${tagCounter}`;
}

export class ORSetCRDT<T extends string> {
  private state: ORSet<T>;

  constructor() {
    this.state = { added: {}, removed: [] };
  }

  /** Add an element to the set. Returns the generated tag. */
  add(element: T, nodeId: string): string {
    const tag = generateTag(nodeId);
    this.state = orSetAdd<T>(this.state, element, tag);
    return tag;
  }

  /** Remove an element from the set. */
  remove(element: T): void {
    this.state = orSetRemove<T>(this.state, element);
  }

  /** Check whether an element is currently in the set. */
  has(element: T): boolean {
    return orSetContains<T>(this.state, element);
  }

  /** Return all current members of the set. */
  values(): string[] {
    return orSetValues<T>(this.state);
  }

  /** Read the full state for serialisation / sync. */
  getState(): ORSet<T> {
    return {
      added: { ...this.state.added },
      removed: [...this.state.removed],
    };
  }

  /** Merge a remote OR-Set state into the local one. */
  merge(remote: ORSet<T>): void {
    this.state = mergeORSet<T>(this.state, remote);
  }

  /** Restore state from a serialised snapshot. */
  static fromState<T extends string>(state: ORSet<T>): ORSetCRDT<T> {
    const instance = Object.create(ORSetCRDT.prototype) as ORSetCRDT<T>;
    instance.state = {
      added: { ...state.added },
      removed: [...state.removed],
    };
    return instance;
  }
}
