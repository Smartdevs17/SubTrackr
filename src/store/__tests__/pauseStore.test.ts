/**
 * Tests for pause/resume billing adjustments (Issue #1116).
 */

import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  calculateEarlyResumeCredit,
  calculatePauseCredit,
  expireCredit,
  initiatePause,
  previewPause,
  resumePause,
  usePauseStore,
  validatePauseRequest,
} from '../pauseStore';
import { PauseReason, PauseState, DEFAULT_PAUSE_LIMITS, type PauseRecord } from '../../types/pause';
import { BillingCycle, SubscriptionCategory, type Subscription } from '../../types/subscription';

const subscription: Subscription = {
  id: 'sub_1',
  name: 'Netflix',
  category: SubscriptionCategory.STREAMING,
  price: 30,
  currency: 'USD',
  billingCycle: BillingCycle.MONTHLY,
  isActive: true,
  isCryptoEnabled: false,
  nextBillingDate: new Date('2026-02-01T00:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('pause credit calculations', () => {
  it('credits the unused portion of the billing period', () => {
    expect(calculatePauseCredit(subscription, 15)).toBe(15);
    expect(calculatePauseCredit(subscription, 7)).toBe(7);
  });

  it('returns zero for a free subscription', () => {
    expect(calculatePauseCredit({ ...subscription, price: 0 }, 15)).toBe(0);
  });

  it('refunds the unconsumed credit when resuming early', () => {
    const record: PauseRecord = {
      id: 'p1',
      subscriptionId: 'sub_1',
      state: PauseState.PAUSED,
      reason: PauseReason.VACATION,
      pausedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      scheduledResumeAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      creditAmount: 10,
      currency: 'USD',
      creditRemaining: 10,
      creditExpired: false,
      creditExpiryDays: 90,
    };

    const credit = calculateEarlyResumeCredit(record);
    expect(credit).toBeGreaterThanOrEqual(6);
    expect(credit).toBeLessThanOrEqual(7);
  });

  it('produces a preview before the pause is committed', () => {
    const preview = previewPause(subscription, 30);
    expect(preview.creditAmount).toBe(30);
    expect(preview.currency).toBe('USD');
    expect(preview.scheduledResumeAt.getTime()).toBeGreaterThan(Date.now());
    expect(preview.earlyResumeCredit).toBe(30);
  });
});

describe('validatePauseRequest', () => {
  it('accepts a pause inside the configured limits', () => {
    expect(validatePauseRequest('sub_1', 14, [])).toEqual({ valid: true });
  });

  it('rejects a pause shorter than the minimum', () => {
    const result = validatePauseRequest('sub_1', 1, []);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain(String(DEFAULT_PAUSE_LIMITS.minDays));
  });

  it('rejects a pause longer than the maximum', () => {
    expect(validatePauseRequest('sub_1', 400, []).valid).toBe(false);
  });

  it('rejects a second pause while one is active', () => {
    const record = initiatePause(subscription, 14, PauseReason.VACATION);
    const result = validatePauseRequest('sub_1', 14, [record]);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('already paused');
  });

  it('enforces the yearly pause quota', () => {
    const first = initiatePause(subscription, 14, PauseReason.VACATION);
    const completed: PauseRecord[] = [
      { ...first, state: PauseState.ACTIVE, resumedAt: new Date() },
      { ...first, id: 'p2', state: PauseState.ACTIVE, resumedAt: new Date() },
    ];
    const result = validatePauseRequest('sub_1', 14, completed);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('per year');
  });
});

describe('pause state transitions', () => {
  it('initiates a pause with a full credit balance', () => {
    const record = initiatePause(subscription, 14, PauseReason.VACATION, 'traveling');
    expect(record.state).toBe(PauseState.PAUSED);
    expect(record.creditAmount).toBe(14);
    expect(record.creditRemaining).toBe(14);
    expect(record.note).toBe('traveling');
    expect(record.scheduledResumeAt.getTime()).toBeGreaterThan(record.pausedAt.getTime());
  });

  it('clears the remaining credit when the schedule completes', () => {
    const record = initiatePause(subscription, 14, PauseReason.VACATION);
    const resumed = resumePause(record, false);
    expect(resumed.state).toBe(PauseState.ACTIVE);
    expect(resumed.creditRemaining).toBe(0);
    expect(resumed.resumedAt).toBeDefined();
  });

  it('expires credit when the subscription is cancelled', () => {
    const record = initiatePause(subscription, 14, PauseReason.VACATION);
    const expired = expireCredit(record);
    expect(expired.creditExpired).toBe(true);
    expect(expired.creditRemaining).toBe(0);
  });
});

describe('usePauseStore', () => {
  beforeEach(() => {
    usePauseStore.setState({ records: [], isLoading: false, error: null });
  });

  it('persists a pause and exposes it as active', () => {
    const store = usePauseStore.getState();
    const record = store.pauseSubscription(subscription, 14, PauseReason.VACATION);

    expect(record.creditAmount).toBe(14);
    expect(usePauseStore.getState().getActivePause('sub_1')?.id).toBe(record.id);
    expect(usePauseStore.getState().getPauseHistory('sub_1')).toHaveLength(1);
  });

  it('throws when pausing beyond the limits', () => {
    const store = usePauseStore.getState();
    expect(() => store.pauseSubscription(subscription, 1, PauseReason.VACATION)).toThrow();
  });

  it('resumes an active pause and releases the credit', () => {
    usePauseStore.getState().pauseSubscription(subscription, 14, PauseReason.VACATION);
    const resumed = usePauseStore.getState().resumeSubscription('sub_1', false);

    expect(resumed?.state).toBe(PauseState.ACTIVE);
    expect(usePauseStore.getState().getActivePause('sub_1')).toBeUndefined();
  });

  it('returns null when resuming a subscription that is not paused', () => {
    expect(usePauseStore.getState().resumeSubscription('missing')).toBeNull();
  });

  it('validates against the current records', () => {
    usePauseStore.getState().pauseSubscription(subscription, 14, PauseReason.VACATION);
    const result = usePauseStore.getState().validatePause('sub_1', 14);
    expect(result.valid).toBe(false);
  });

  it('expires credit for a cancelled subscription', () => {
    const record = usePauseStore
      .getState()
      .pauseSubscription(subscription, 14, PauseReason.VACATION);
    usePauseStore.getState().expireCreditForSubscription('sub_1');
    const stored = usePauseStore.getState().records.find((r) => r.id === record.id);
    expect(stored?.creditExpired).toBe(true);
    expect(stored?.creditRemaining).toBe(0);
  });

  it('previews a pause through the store', () => {
    const preview = usePauseStore.getState().previewPause(subscription, 7);
    expect(preview.creditAmount).toBe(7);
  });
});
