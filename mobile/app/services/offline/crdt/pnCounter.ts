/**
 * PN-Counter (Positive-Negative Counter) CRDT implementation.
 *
 * Each node maintains its own positive and negative G-Counters.
 * The effective value is sum(positive) - sum(negative).
 * Merge takes the component-wise maximum in each G-Counter, ensuring
 * monotonic growth and eventual convergence.
 */

import {
  PNCounter,
  pnCounterValue,
  pnCounterIncrement,
  pnCounterDecrement,
  mergePNCounter,
} from '../../../../../shared/types/crdt';

export class PNCounterCRDT {
  private state: PNCounter;

  constructor() {
    this.state = { positive: {}, negative: {} };
  }

  /** Return the current effective value of the counter. */
  value(): number {
    return pnCounterValue(this.state);
  }

  /** Increment by `amount` (default 1) for the given node. */
  increment(nodeId: string, amount = 1): void {
    this.state = pnCounterIncrement(this.state, nodeId, amount);
  }

  /** Decrement by `amount` (default 1) for the given node. */
  decrement(nodeId: string, amount = 1): void {
    this.state = pnCounterDecrement(this.state, nodeId, amount);
  }

  /** Read the full state for serialisation / sync. */
  getState(): PNCounter {
    return {
      positive: { ...this.state.positive },
      negative: { ...this.state.negative },
    };
  }

  /** Merge a remote counter state into the local one. */
  merge(remote: PNCounter): void {
    this.state = mergePNCounter(this.state, remote);
  }

  /** Restore state from a serialised snapshot. */
  static fromState(state: PNCounter): PNCounterCRDT {
    const instance = Object.create(PNCounterCRDT.prototype) as PNCounterCRDT;
    instance.state = {
      positive: { ...state.positive },
      negative: { ...state.negative },
    };
    return instance;
  }
}
