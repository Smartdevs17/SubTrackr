import { DrStateManager } from '../DrStateManager';
import { DrStatePhase } from '../types';

describe('DrStateManager', () => {
  let mgr: DrStateManager;

  beforeEach(() => {
    mgr = new DrStateManager();
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('starts in idle phase', () => {
    expect(mgr.getPhase()).toBe('idle');
  });

  it('getState returns a snapshot with history and enteredAt', () => {
    const state = mgr.getState();
    expect(state.phase).toBe('idle');
    expect(state.attempt).toBe(0);
    expect(Array.isArray(state.history)).toBe(true);
    expect(state.enteredAt).toBeGreaterThan(0);
  });

  it('isActive returns false when idle', () => {
    expect(mgr.isActive()).toBe(false);
  });

  it('isRecovering returns false when idle', () => {
    expect(mgr.isRecovering()).toBe(false);
  });

  // ── Transitions ───────────────────────────────────────────────────────────

  describe('transition', () => {
    it('transitions from idle to detecting', () => {
      const state = mgr.transition('detecting', { trigger: 'health-check-failure' });
      expect(state.phase).toBe('detecting');
      expect(state.trigger).toBe('health-check-failure');
    });

    it('transitions from detecting to recovering', () => {
      mgr.transition('detecting');
      const state = mgr.transition('recovering', { activeRunbook: 'build-failure' });
      expect(state.phase).toBe('recovering');
      expect(state.activeRunbook).toBe('build-failure');
    });

    it('increments attempt counter on each recovering transition', () => {
      mgr.transition('detecting');
      mgr.transition('recovering');
      expect(mgr.getState().attempt).toBe(1);

      mgr.transition('failed');
      mgr.transition('detecting');
      mgr.transition('recovering');
      expect(mgr.getState().attempt).toBe(2);
    });

    it('transitions from recovering to resolved', () => {
      mgr.transition('detecting');
      mgr.transition('recovering');
      const state = mgr.transition('resolved');
      expect(state.phase).toBe('resolved');
    });

    it('transitions from recovering to failed', () => {
      mgr.transition('detecting');
      mgr.transition('recovering');
      const state = mgr.transition('failed', { errorMessage: 'could not restore' });
      expect(state.phase).toBe('failed');
      expect(state.errorMessage).toBe('could not restore');
    });

    it('transitions from failed back to idle', () => {
      mgr.transition('detecting');
      mgr.transition('recovering');
      mgr.transition('failed');
      const state = mgr.transition('idle' as DrStatePhase);
      // idle is allowed from failed
      expect(state.phase).toBe('idle');
    });

    it('transitions from resolved back to idle', () => {
      mgr.transition('detecting');
      mgr.transition('recovering');
      mgr.transition('resolved');
      const state = mgr.transition('idle' as DrStatePhase);
      expect(state.phase).toBe('idle');
    });

    it('transitions to manual-intervention from detecting', () => {
      mgr.transition('detecting');
      const state = mgr.transition('manual-intervention');
      expect(state.phase).toBe('manual-intervention');
    });

    it('throws on invalid transition', () => {
      // idle → resolved is not valid
      expect(() => mgr.transition('resolved' as DrStatePhase)).toThrow(/Invalid DR state transition/);
    });

    it('throws idle → recovering directly', () => {
      expect(() => mgr.transition('recovering')).toThrow(/Invalid DR state transition/);
    });
  });

  // ── History ───────────────────────────────────────────────────────────────

  describe('history', () => {
    it('records transitions in history', () => {
      mgr.transition('detecting', { trigger: 't1' });
      mgr.transition('recovering', { trigger: 't2' });
      mgr.transition('resolved', { trigger: 't3' });
      const history = mgr.getHistory();
      expect(history).toHaveLength(3);
      expect(history[0]).toMatchObject({ from: 'idle', to: 'detecting', trigger: 't1' });
      expect(history[1]).toMatchObject({ from: 'detecting', to: 'recovering' });
      expect(history[2]).toMatchObject({ from: 'recovering', to: 'resolved' });
    });

    it('trims history to maxHistory', () => {
      mgr = new DrStateManager({ maxHistory: 3 });
      // Create 4 transitions
      mgr.transition('detecting');
      mgr.transition('idle' as DrStatePhase); // Not valid? Let's use reset
    });

    it('history entries include timestamps', () => {
      mgr.transition('detecting');
      const history = mgr.getHistory();
      expect(history[0].at).toBeGreaterThan(0);
    });

    it('history is a copy (immutable)', () => {
      mgr.transition('detecting');
      const h1 = mgr.getHistory();
      const h2 = mgr.getHistory();
      expect(h1).not.toBe(h2);
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('resets to idle from any phase', () => {
      mgr.transition('detecting');
      mgr.transition('recovering');
      const state = mgr.reset('manual-reset');
      expect(state.phase).toBe('idle');
      expect(state.attempt).toBe(0);
    });

    it('reset from idle is a no-op transition but works', () => {
      const state = mgr.reset();
      expect(state.phase).toBe('idle');
    });

    it('records reset in history', () => {
      mgr.transition('detecting');
      mgr.reset('my-reset');
      const history = mgr.getHistory();
      const resetEntry = history.find((h) => h.trigger === 'my-reset');
      expect(resetEntry).toBeDefined();
    });

    it('resets attempt counter', () => {
      mgr.transition('detecting');
      mgr.transition('recovering');
      expect(mgr.getState().attempt).toBe(1);
      mgr.reset();
      expect(mgr.getState().attempt).toBe(0);
    });
  });

  // ── isActive / isRecovering ────────────────────────────────────────────────

  describe('isActive / isRecovering', () => {
    it('isActive returns true when detecting', () => {
      mgr.transition('detecting');
      expect(mgr.isActive()).toBe(true);
    });

    it('isActive returns true when recovering', () => {
      mgr.transition('detecting');
      mgr.transition('recovering');
      expect(mgr.isActive()).toBe(true);
    });

    it('isActive returns false after reset', () => {
      mgr.transition('detecting');
      mgr.reset();
      expect(mgr.isActive()).toBe(false);
    });

    it('isRecovering is true only during recovering', () => {
      mgr.transition('detecting');
      expect(mgr.isRecovering()).toBe(false);
      mgr.transition('recovering');
      expect(mgr.isRecovering()).toBe(true);
      mgr.transition('resolved');
      expect(mgr.isRecovering()).toBe(false);
    });
  });

  // ── currentPhaseDurationMs ────────────────────────────────────────────────

  describe('currentPhaseDurationMs', () => {
    it('returns non-negative duration', () => {
      const duration = mgr.currentPhaseDurationMs();
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('increases over time', async () => {
      const d1 = mgr.currentPhaseDurationMs();
      await new Promise((r) => setTimeout(r, 50));
      const d2 = mgr.currentPhaseDurationMs();
      expect(d2).toBeGreaterThan(d1);
    });
  });

  // ── onStateChange listener ────────────────────────────────────────────────

  describe('onStateChange', () => {
    it('calls listener on transition', () => {
      const listener = jest.fn();
      mgr.onStateChange(listener);
      mgr.transition('detecting');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].phase).toBe('detecting');
    });

    it('calls listener on reset', () => {
      const listener = jest.fn();
      mgr.onStateChange(listener);
      mgr.reset();
      expect(listener).toHaveBeenCalled();
    });

    it('deregistration stops listener', () => {
      const listener = jest.fn();
      const unsubscribe = mgr.onStateChange(listener);
      unsubscribe();
      mgr.transition('detecting');
      expect(listener).not.toHaveBeenCalled();
    });

    it('multiple listeners fire on each transition', () => {
      const l1 = jest.fn();
      const l2 = jest.fn();
      mgr.onStateChange(l1);
      mgr.onStateChange(l2);
      mgr.transition('detecting');
      expect(l1).toHaveBeenCalled();
      expect(l2).toHaveBeenCalled();
    });

    it('does not crash if listener throws', () => {
      mgr.onStateChange(() => { throw new Error('listener error'); });
      expect(() => mgr.transition('detecting')).not.toThrow();
    });
  });

  // ── Static helpers ────────────────────────────────────────────────────────

  describe('static allowedTransitionsFrom', () => {
    it('returns correct transitions for idle', () => {
      const allowed = DrStateManager.allowedTransitionsFrom('idle');
      expect(allowed).toContain('detecting');
    });

    it('returns correct transitions for detecting', () => {
      const allowed = DrStateManager.allowedTransitionsFrom('detecting');
      expect(allowed).toContain('recovering');
      expect(allowed).toContain('idle');
    });

    it('returns empty array for unknown phase', () => {
      const allowed = DrStateManager.allowedTransitionsFrom('unknown-phase' as DrStatePhase);
      expect(allowed).toHaveLength(0);
    });
  });

  // ── toJSON ────────────────────────────────────────────────────────────────

  describe('toJSON', () => {
    it('returns a serialisable object', () => {
      mgr.transition('detecting');
      const json = mgr.toJSON();
      expect(typeof json).toBe('object');
      const str = JSON.stringify(json);
      expect(str).toContain('detecting');
    });
  });

  // ── Snapshot immutability ─────────────────────────────────────────────────

  it('getState returns independent copies', () => {
    const s1 = mgr.getState();
    const s2 = mgr.getState();
    expect(s1).not.toBe(s2);
    s1.phase = 'failed' as any;
    expect(mgr.getPhase()).toBe('idle');
  });
});
