/**
 * LWW-Register (Last-Writer-Wins Register) CRDT implementation.
 *
 * A scalar value register where the most recent write — determined by wall-clock
 * timestamp and tie-broken by nodeId — always wins on merge.
 */

import {
  LWWRegister,
  VectorClock,
  mergeLWWRegister,
  incrementClock,
} from '../../../../../shared/types/crdt';

export class LWWRegisterCRDT<T> {
  private state: LWWRegister<T>;

  constructor(
    initialValue: T,
    nodeId: string,
    clock: VectorClock = {},
  ) {
    this.state = {
      value: initialValue,
      timestamp: Date.now(),
      nodeId,
      clock: incrementClock(clock, nodeId),
    };
  }

  /** Read the current value. */
  get(): T {
    return this.state.value;
  }

  /** Read the full register state (for serialisation / sync). */
  getState(): LWWRegister<T> {
    return { ...this.state };
  }

  /**
   * Write a new value.  Increments the local node's clock entry and records
   * the current wall-clock time.
   */
  set(value: T, nodeId: string): void {
    const newClock = incrementClock(this.state.clock, nodeId);
    this.state = {
      value,
      timestamp: Date.now(),
      nodeId,
      clock: newClock,
    };
  }

  /**
   * Merge a remote register state into the local one.
   * Returns true if the local state changed.
   */
  merge(remote: LWWRegister<T>): boolean {
    const before = this.state;
    this.state = mergeLWWRegister(this.state, remote);
    return this.state !== before;
  }

  /** Restore state from a serialised snapshot (e.g. from AsyncStorage). */
  static fromState<T>(state: LWWRegister<T>): LWWRegisterCRDT<T> {
    const instance = Object.create(LWWRegisterCRDT.prototype) as LWWRegisterCRDT<T>;
    instance.state = { ...state };
    return instance;
  }
}
