/**
 * Tests for the per-plan PauseWindowRegistry (Issue #1723).
 *
 * Acceptance criterion: "Pause window configurable"
 *
 * The registry allows each subscription plan to override the global
 * DEFAULT_PAUSE_LIMITS with its own min/max duration and yearly cap.
 * These tests confirm that:
 *   - Plans fall back to global defaults when no window is registered.
 *   - Registered windows override defaults for a specific plan.
 *   - Invalid window configurations are rejected at registration time.
 *   - The controller-to-store path honours per-plan limits (via PauseStateStore).
 *   - Resuming shifts the next billing date forward by the actual pause duration.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  PauseWindowRegistry,
  pauseWindowRegistry,
  DEFAULT_PAUSE_LIMITS,
  validatePauseRequest,
} from '../pauseBilling';
import { PauseStateStore } from '../pauseStateStore';

// ─── PauseWindowRegistry unit tests ──────────────────────────────────────────

describe('PauseWindowRegistry', () => {
  let registry: PauseWindowRegistry;

  beforeEach(() => {
    registry = new PauseWindowRegistry();
  });

  it('returns global defaults for an unregistered plan', () => {
    const limits = registry.getLimitsForPlan('plan_unknown');
    expect(limits).toEqual(DEFAULT_PAUSE_LIMITS);
  });

  it('registers a per-plan window and returns its limits', () => {
    registry.register({
      planId: 'plan_basic',
      minDays: 3,
      maxDays: 30,
      maxPausesPerYear: 4,
      description: 'Basic plan: short pauses allowed',
    });

    const limits = registry.getLimitsForPlan('plan_basic');
    expect(limits.minDays).toBe(3);
    expect(limits.maxDays).toBe(30);
    expect(limits.maxPausesPerYear).toBe(4);
  });

  it('does not expose description in PauseLimits', () => {
    registry.register({ planId: 'plan_x', minDays: 1, maxDays: 10, maxPausesPerYear: 1 });
    const limits = registry.getLimitsForPlan('plan_x');
    expect((limits as { description?: string }).description).toBeUndefined();
  });

  it('allows replacing an existing window', () => {
    registry.register({ planId: 'plan_pro', minDays: 7, maxDays: 60, maxPausesPerYear: 2 });
    registry.register({ planId: 'plan_pro', minDays: 14, maxDays: 90, maxPausesPerYear: 3 });
    const limits = registry.getLimitsForPlan('plan_pro');
    expect(limits.minDays).toBe(14);
    expect(limits.maxDays).toBe(90);
  });

  it('removes a window and reverts to defaults', () => {
    registry.register({ planId: 'plan_y', minDays: 1, maxDays: 10, maxPausesPerYear: 1 });
    registry.remove('plan_y');
    expect(registry.getLimitsForPlan('plan_y')).toEqual(DEFAULT_PAUSE_LIMITS);
  });

  it('lists all registered windows', () => {
    registry.register({ planId: 'a', minDays: 1, maxDays: 5, maxPausesPerYear: 1 });
    registry.register({ planId: 'b', minDays: 7, maxDays: 90, maxPausesPerYear: 2 });
    const all = registry.list();
    expect(all).toHaveLength(2);
    expect(all.map((w) => w.planId)).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('clears all windows', () => {
    registry.register({ planId: 'a', minDays: 1, maxDays: 5, maxPausesPerYear: 1 });
    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });

  it('getWindow returns undefined for an unregistered plan', () => {
    expect(registry.getWindow('nope')).toBeUndefined();
  });

  it('getWindow returns the raw config for a registered plan', () => {
    const win = { planId: 'p1', minDays: 2, maxDays: 20, maxPausesPerYear: 3, description: 'test' };
    registry.register(win);
    expect(registry.getWindow('p1')).toEqual(win);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it('rejects minDays < 1', () => {
    expect(() =>
      registry.register({ planId: 'bad', minDays: 0, maxDays: 10, maxPausesPerYear: 1 })
    ).toThrow('minDays must be a positive integer');
  });

  it('rejects non-finite minDays', () => {
    expect(() =>
      registry.register({ planId: 'bad', minDays: NaN, maxDays: 10, maxPausesPerYear: 1 })
    ).toThrow('minDays');
  });

  it('rejects maxDays <= minDays', () => {
    expect(() =>
      registry.register({ planId: 'bad', minDays: 10, maxDays: 10, maxPausesPerYear: 1 })
    ).toThrow('maxDays must be greater than minDays');
  });

  it('rejects maxPausesPerYear < 1', () => {
    expect(() =>
      registry.register({ planId: 'bad', minDays: 1, maxDays: 10, maxPausesPerYear: 0 })
    ).toThrow('maxPausesPerYear must be at least 1');
  });
});

// ─── Per-plan limits in validatePauseRequest ──────────────────────────────────

describe('validatePauseRequest with per-plan limits', () => {
  it('accepts a duration within per-plan bounds that exceeds global limits', () => {
    const limits = { minDays: 1, maxDays: 180, maxPausesPerYear: 5 };
    expect(validatePauseRequest(120, false, 0, limits)).toEqual({ valid: true });
  });

  it('rejects a duration below per-plan minimum', () => {
    const limits = { minDays: 14, maxDays: 60, maxPausesPerYear: 2 };
    const result = validatePauseRequest(5, false, 0, limits);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('14 days');
  });

  it('rejects a duration above per-plan maximum', () => {
    const limits = { minDays: 7, maxDays: 30, maxPausesPerYear: 2 };
    const result = validatePauseRequest(60, false, 0, limits);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('30 days');
  });

  it('rejects when per-plan yearly quota is exhausted', () => {
    const limits = { minDays: 7, maxDays: 90, maxPausesPerYear: 1 };
    const result = validatePauseRequest(14, false, 1, limits);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('1');
  });
});

// ─── PauseStateStore + per-plan registry integration ─────────────────────────

describe('PauseStateStore respects per-plan PauseWindowRegistry', () => {
  let store: PauseStateStore;

  const seed = {
    subscriptionId: 'sub_plan_test',
    price: 60,
    currency: 'USD',
    periodDays: 30,
    reason: 'vacation' as const,
  };

  beforeEach(() => {
    store = new PauseStateStore();
    // Register a plan with a short max pause window (10 days).
    pauseWindowRegistry.clear();
    pauseWindowRegistry.register({
      planId: 'plan_limited',
      minDays: 1,
      maxDays: 10,
      maxPausesPerYear: 3,
    });
  });

  it('allows a pause within the per-plan window', () => {
    const session = store.pause({ ...seed, pauseDays: 7, planId: 'plan_limited' });
    expect(session.status).toBe('paused');
    expect(session.adjustment.creditAmount).toBe(14);
  });

  it('rejects a pause exceeding the per-plan max', () => {
    expect(() =>
      store.pause({ ...seed, pauseDays: 30, planId: 'plan_limited' })
    ).toThrow('Maximum pause duration is 10 days.');
  });

  it('falls back to global defaults when no planId is given', () => {
    // Global default max is 90 days — 30 days is within bounds.
    const session = store.pause({ ...seed, pauseDays: 30 });
    expect(session.status).toBe('paused');
  });

  it('falls back to global defaults for an unregistered planId', () => {
    const session = store.pause({ ...seed, pauseDays: 30, planId: 'plan_nonexistent' });
    expect(session.status).toBe('paused');
  });
});

// ─── nextBillingDate shift on resume (Issue #1723) ──────────────────────────

describe('PauseStateStore.resume() shifts nextBillingDate', () => {
  let store: PauseStateStore;

  const seed = {
    subscriptionId: 'sub_bd',
    price: 30,
    currency: 'USD',
    periodDays: 30,
    pauseDays: 14,
    reason: 'vacation' as const,
  };

  beforeEach(() => {
    store = new PauseStateStore();
  });

  it('sets nextBillingDate 14 days ahead on a full scheduled resume', () => {
    const pausedAt = new Date('2026-01-01T00:00:00.000Z');
    store.pause(seed, pausedAt);
    const resumeAt = new Date('2026-01-15T00:00:00.000Z');
    const resumed = store.resume('sub_bd', false, resumeAt);
    // On a scheduled resume, actualPausedDays == pauseDays (14).
    expect(resumed.nextBillingDate).toBe('2026-01-29T00:00:00.000Z');
  });

  it('sets nextBillingDate proportional to actual days elapsed on early resume', () => {
    const pausedAt = new Date('2026-01-01T00:00:00.000Z');
    store.pause(seed, pausedAt);
    // Resume after 7 days (half the intended pause).
    const resumeAt = new Date('2026-01-08T00:00:00.000Z');
    const resumed = store.resume('sub_bd', true, resumeAt);
    // actualPausedDays == 7 days elapsed → shift 7 days from resumeAt.
    expect(resumed.nextBillingDate).toBe('2026-01-15T00:00:00.000Z');
  });

  it('exposes nextBillingDate on an auto-resumed session', () => {
    store.pause(seed, new Date('2026-01-01T00:00:00.000Z'));
    const [autoResumed] = store.autoResumeDue(new Date('2026-01-20T00:00:00.000Z'));
    expect(autoResumed.nextBillingDate).toBeDefined();
  });
});
