import { DrStateEntry, DrStatePhase, DrStateTransition } from './types';

// ---------------------------------------------------------------------------
// Allowed transitions
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Partial<Record<DrStatePhase, DrStatePhase[]>> = {
  idle: ['detecting'],
  detecting: ['recovering', 'idle', 'manual-intervention'],
  recovering: ['resolved', 'failed', 'manual-intervention'],
  resolved: ['idle'],
  failed: ['idle', 'detecting'],
  'manual-intervention': ['idle', 'detecting', 'recovering'],
};

// ---------------------------------------------------------------------------
// DrStateManager
// ---------------------------------------------------------------------------

/**
 * In-memory state machine for Disaster Recovery operations.
 *
 * Transitions:
 *
 *  idle → detecting → recovering → resolved → idle
 *                   ↘ manual-intervention
 *            failed → idle | detecting
 *
 * Thread-safety: All mutations are synchronous in-process operations.
 * Persist the state externally if cross-process durability is required.
 */
export class DrStateManager {
  private _state: DrStateEntry;
  private readonly _maxHistory: number;
  private _listeners: Array<(state: DrStateEntry) => void>;

  constructor(options: { maxHistory?: number } = {}) {
    this._maxHistory = options.maxHistory ?? 100;
    this._listeners = [];
    this._state = {
      phase: 'idle',
      enteredAt: Date.now(),
      attempt: 0,
      history: [],
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Returns the current state snapshot (immutable copy). */
  getState(): DrStateEntry {
    return this._snapshot();
  }

  /** Returns the current phase. */
  getPhase(): DrStatePhase {
    return this._state.phase;
  }

  /**
   * Transitions to a new phase.
   * @throws Error if the transition is not allowed.
   */
  transition(
    to: DrStatePhase,
    options: {
      trigger?: string;
      activeRunbook?: string;
      errorMessage?: string;
    } = {}
  ): DrStateEntry {
    const from = this._state.phase;
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];

    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid DR state transition: ${from} → ${to}. Allowed from ${from}: [${allowed.join(', ')}]`
      );
    }

    const transition: DrStateTransition = {
      from,
      to,
      at: Date.now(),
      trigger: options.trigger,
    };

    const history = [...this._state.history, transition].slice(-this._maxHistory);

    this._state = {
      phase: to,
      enteredAt: Date.now(),
      trigger: options.trigger,
      activeRunbook: options.activeRunbook ?? (to === 'recovering' ? this._state.activeRunbook : undefined),
      attempt: to === 'recovering' ? this._state.attempt + 1 : this._state.attempt,
      errorMessage: options.errorMessage,
      history,
    };

    this._notify();
    return this._snapshot();
  }

  /**
   * Reset state to idle. Can be called from any phase.
   */
  reset(trigger = 'manual-reset'): DrStateEntry {
    const from = this._state.phase;
    const transition: DrStateTransition = { from, to: 'idle', at: Date.now(), trigger };
    const history = [...this._state.history, transition].slice(-this._maxHistory);

    this._state = {
      phase: 'idle',
      enteredAt: Date.now(),
      attempt: 0,
      history,
      trigger,
    };

    this._notify();
    return this._snapshot();
  }

  /** Returns true if the state machine is in a non-idle active phase. */
  isActive(): boolean {
    return this._state.phase !== 'idle';
  }

  /** Returns true if recovery is currently in progress. */
  isRecovering(): boolean {
    return this._state.phase === 'recovering';
  }

  /** Returns the full state transition history. */
  getHistory(): DrStateTransition[] {
    return [...this._state.history];
  }

  /**
   * Returns the duration in ms spent in the current phase.
   */
  currentPhaseDurationMs(): number {
    return Date.now() - this._state.enteredAt;
  }

  /**
   * Register a listener that fires on every state change.
   * Returns a de-registration function.
   */
  onStateChange(listener: (state: DrStateEntry) => void): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Returns a serialisable snapshot suitable for persistence / API responses.
   */
  toJSON(): object {
    return this._snapshot();
  }

  // ── Static Helpers ─────────────────────────────────────────────────────

  /** Returns the allowed next phases from a given phase. */
  static allowedTransitionsFrom(phase: DrStatePhase): DrStatePhase[] {
    return [...(ALLOWED_TRANSITIONS[phase] ?? [])];
  }

  // ── Private ────────────────────────────────────────────────────────────

  private _snapshot(): DrStateEntry {
    return {
      ...this._state,
      history: [...this._state.history],
    };
  }

  private _notify(): void {
    const snap = this._snapshot();
    for (const listener of this._listeners) {
      try {
        listener(snap);
      } catch {
        // listeners must not throw
      }
    }
  }
}

export const drStateManager = new DrStateManager();
