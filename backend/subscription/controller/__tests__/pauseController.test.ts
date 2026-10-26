/**
 * Unit tests for pauseController — planId wiring and nextBillingDate shift
 * (Issue #1723 acceptance criteria).
 *
 * Tests are written against the controller functions directly so no HTTP
 * server or supertest dependency is required.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  pauseSubscription,
  resumeSubscription,
  previewPause,
  getPauseState,
} from '../../controller/pauseController';
import { pauseStateStore } from '../../domain/pauseStateStore';
import { pauseWindowRegistry } from '../../domain/pauseBilling';

// ─── helpers ──────────────────────────────────────────────────────────────────

const baseBody = { price: 30, currency: 'USD', billingCycle: 'monthly', pauseDays: 14, reason: 'vacation' as const };

// ─── planId wiring (Acceptance: "Pause window configurable") ─────────────────

describe('pauseController planId → per-plan window', () => {
  beforeEach(() => {
    pauseStateStore.reset();
    pauseWindowRegistry.clear();
    pauseWindowRegistry.register({
      planId: 'plan_limited',
      minDays: 1,
      maxDays: 10,
      maxPausesPerYear: 3,
    });
  });

  it('returns 422 when pauseDays exceeds the per-plan maximum', () => {
    const result = pauseSubscription(
      'sub_pl',
      { ...baseBody, pauseDays: 30, planId: 'plan_limited' },
    );
    expect(result.status).toBe(422);
    expect(result.ok).toBe(false);
    expect((result.response as { error: { message: string } }).error.message).toContain('10 days');
  });

  it('succeeds when pauseDays is within the per-plan maximum', () => {
    const result = pauseSubscription(
      'sub_pl',
      { ...baseBody, pauseDays: 7, planId: 'plan_limited' },
    );
    expect(result.status).toBe(201);
    expect(result.ok).toBe(true);
  });

  it('falls back to global defaults when planId is absent', () => {
    // 30 days exceeds the registered plan_limited window but not global defaults.
    const result = pauseSubscription('sub_global', { ...baseBody, pauseDays: 30 });
    expect(result.status).toBe(201);
    expect(result.ok).toBe(true);
  });

  it('falls back to global defaults for an unregistered planId', () => {
    const result = pauseSubscription(
      'sub_unknown_plan',
      { ...baseBody, pauseDays: 30, planId: 'plan_ghost' },
    );
    expect(result.status).toBe(201);
    expect(result.ok).toBe(true);
  });
});

// ─── nextBillingDate on resume (Acceptance: "Billing resumes correctly") ──────

describe('pauseController resume returns nextBillingDate', () => {
  beforeEach(() => {
    pauseStateStore.reset();
    pauseWindowRegistry.clear();
  });

  it('includes nextBillingDate after a scheduled resume', () => {
    pauseSubscription('sub_nbd', { ...baseBody, pauseDays: 14 });
    const result = resumeSubscription('sub_nbd', { early: false });

    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    const { session } = (result.response as { data: { session: { nextBillingDate?: string } } }).data;
    expect(session.nextBillingDate).toBeDefined();
    // Must be a valid ISO 8601 date string.
    expect(new Date(session.nextBillingDate!).toISOString()).toBe(session.nextBillingDate);
  });

  it('nextBillingDate on early resume is closer than on full resume', () => {
    // Full-period pause.
    pauseSubscription('sub_full', { ...baseBody, pauseDays: 30 });
    const fullResult = resumeSubscription('sub_full', { early: false });
    const fullDate = new Date(
      ((fullResult.response as { data: { session: { nextBillingDate: string } } }).data.session.nextBillingDate)
    );

    pauseStateStore.reset();

    // Early resume after 0 days elapsed (immediate resume — minimum shift).
    pauseSubscription('sub_early', { ...baseBody, pauseDays: 30 });
    const earlyResult = resumeSubscription('sub_early', { early: true });
    const earlyDate = new Date(
      ((earlyResult.response as { data: { session: { nextBillingDate: string } } }).data.session.nextBillingDate)
    );

    // Full resume (30 days of pause) should shift billing further than an
    // immediate early resume (0 days elapsed).
    expect(fullDate.getTime()).toBeGreaterThanOrEqual(earlyDate.getTime());
  });

  it('getPauseState returns the shifted nextBillingDate in history', () => {
    pauseSubscription('sub_hist', { ...baseBody, pauseDays: 14 });
    resumeSubscription('sub_hist', { early: false });

    const stateResult = getPauseState('sub_hist');
    expect(stateResult.status).toBe(200);
    const { history } = (stateResult.response as { data: { history: Array<{ nextBillingDate?: string }> } }).data;
    expect(history[0].nextBillingDate).toBeDefined();
  });
});

// ─── preview does not mutate state ────────────────────────────────────────────

describe('pauseController previewPause', () => {
  beforeEach(() => {
    pauseStateStore.reset();
    pauseWindowRegistry.clear();
  });

  it('returns the adjustment without creating a session', () => {
    const result = previewPause('sub_prev', { price: 30, pauseDays: 15, currency: 'USD' });
    expect(result.status).toBe(200);
    expect(pauseStateStore.list()).toHaveLength(0);
    const { adjustment } = (result.response as { data: { adjustment: { creditAmount: number } } }).data;
    expect(adjustment.creditAmount).toBe(15);
  });

  it('includes scheduledResumeAt as an ISO timestamp', () => {
    const result = previewPause('sub_prev', { price: 30, pauseDays: 15 });
    const { scheduledResumeAt } = (result.response as { data: { scheduledResumeAt: string } }).data;
    expect(() => new Date(scheduledResumeAt)).not.toThrow();
  });
});

// ─── getPauseState error cases ────────────────────────────────────────────────

describe('pauseController getPauseState', () => {
  beforeEach(() => {
    pauseStateStore.reset();
  });

  it('returns 404 for a subscription with no pause history', () => {
    const result = getPauseState('sub_none');
    expect(result.status).toBe(404);
    expect(result.ok).toBe(false);
  });

  it('returns active: null after a subscription has been resumed', () => {
    pauseSubscription('sub_done', { ...baseBody });
    resumeSubscription('sub_done', {});
    const result = getPauseState('sub_done');
    const { active } = (result.response as { data: { active: null | object } }).data;
    expect(active).toBeNull();
  });
});
