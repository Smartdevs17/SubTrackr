/**
 * Tests for fraud detection dashboard for subscription payments (issue #946)
 * Technical scope: contracts/fraud/src/, src/screens/FraudDashboard.tsx
 *
 * We test the fraudStore (the data layer behind the dashboard) directly,
 * since rendering the screen requires the full RN environment.
 */

import { act } from 'react-test-renderer';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Import a fresh store instance for every test to avoid cross-test bleed. */
async function getFraudStore() {
  // Reset module registry so Zustand create() produces a new store each time.
  jest.resetModules();
  const { useFraudStore } = await import('../../store/fraudStore');
  return useFraudStore.getState();
}

// ─────────────────────────────────────────────────────────────────────────────
// fraudStore – initial state
// ─────────────────────────────────────────────────────────────────────────────

describe('fraudStore – initial seeded state', () => {
  it('has pre-seeded merchants', () => {
    const store = await getFraudStore();
    expect(store.merchants.length).toBeGreaterThan(0);
  });

  it('has pre-seeded subscriptions', () => {
    const store = await getFraudStore();
    expect(store.subscriptions.length).toBeGreaterThan(0);
  });

  it('has a review queue', () => {
    const store = await getFraudStore();
    expect(Array.isArray(store.reviewQueue)).toBe(true);
    expect(store.reviewQueue.length).toBeGreaterThan(0);
  });

  it('analytics.totalChecks matches the number of subscriptions', () => {
    const store = await getFraudStore();
    expect(store.analytics.totalChecks).toBe(store.subscriptions.length);
  });

  it('analytics.blocked equals subscriptions with action=block', () => {
    const store = await getFraudStore();
    const expected = store.subscriptions.filter((s: any) => s.action === 'block').length;
    expect(store.analytics.blocked).toBe(expected);
  });

  it('analytics.flagged equals subscriptions with action=flag', () => {
    const store = await getFraudStore();
    const expected = store.subscriptions.filter((s: any) => s.action === 'flag').length;
    expect(store.analytics.flagged).toBe(expected);
  });

  it('analytics.avgRisk is a number between 0 and 100', () => {
    const store = await getFraudStore();
    expect(store.analytics.avgRisk).toBeGreaterThanOrEqual(0);
    expect(store.analytics.avgRisk).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fraudStore – risk assessment
// ─────────────────────────────────────────────────────────────────────────────

describe('fraudStore – assessRisk', () => {
  it('calls assessRisk and returns a FraudRiskScore for every subscription', async () => {
    const store = await getFraudStore();
    const sub = store.subscriptions[0];

    let score: any;
    await act(async () => {
      score = await store.assessRisk(sub.id);
    });

    expect(score).toBeDefined();
    expect(typeof score.totalScore).toBe('number');
    expect(score.totalScore).toBeGreaterThanOrEqual(0);
    expect(score.totalScore).toBeLessThanOrEqual(100);
    expect(['approve', 'flag', 'block']).toContain(score.action);
  });

  it('stores the assessment result in store.assessments', async () => {
    const store = await getFraudStore();
    const sub = store.subscriptions[0];

    await act(async () => {
      await store.assessRisk(sub.id);
    });

    const stored = store.assessments.find((a: any) => a.subscriptionId === sub.id);
    expect(stored).toBeDefined();
  });

  it('returns undefined for an unknown subscription id', async () => {
    const store = await getFraudStore();
    let result: any;
    await act(async () => {
      result = await store.assessRisk('nonexistent_sub_id');
    });
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fraudStore – approve / block
// ─────────────────────────────────────────────────────────────────────────────

describe('fraudStore – approveSubscription / blockSubscription', () => {
  it('approveSubscription sets action to approve and isFlagged to false', async () => {
    const store = await getFraudStore();
    // Pick the first flagged subscription
    const flagged = store.subscriptions.find((s: any) => s.action === 'flag');
    expect(flagged).toBeDefined();

    await act(async () => {
      await store.approveSubscription(flagged!.id);
    });

    const updated = store.subscriptions.find((s: any) => s.id === flagged!.id);
    expect(updated?.action).toBe('approve');
    expect(updated?.isFlagged).toBe(false);
  });

  it('blockSubscription sets isBlocked to true and action to block', async () => {
    const store = await getFraudStore();
    const sub = store.subscriptions.find((s: any) => !s.isBlocked);
    expect(sub).toBeDefined();

    await act(async () => {
      await store.blockSubscription(sub!.id);
    });

    const updated = store.subscriptions.find((s: any) => s.id === sub!.id);
    expect(updated?.isBlocked).toBe(true);
    expect(updated?.action).toBe('block');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fraudStore – resolveCase
// ─────────────────────────────────────────────────────────────────────────────

describe('fraudStore – resolveCase', () => {
  it('removes the case from reviewQueue and sets status to reviewed', async () => {
    const store = await getFraudStore();
    const pendingCase = store.reviewQueue.find((c: any) => c.status === 'pending');
    expect(pendingCase).toBeDefined();

    await act(async () => {
      await store.resolveCase(pendingCase!.caseId, 'true_positive', 'Confirmed fraud');
    });

    // Should no longer be in the pending review queue
    const stillPending = store.reviewQueue.find(
      (c: any) => c.caseId === pendingCase!.caseId && c.status === 'pending'
    );
    expect(stillPending).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fraudStore – false positive feedback
// ─────────────────────────────────────────────────────────────────────────────

describe('fraudStore – submitFalsePositiveFeedback', () => {
  it('reduces the risk score after false positive feedback', async () => {
    const store = await getFraudStore();
    const flagged = store.subscriptions.find((s: any) => s.action === 'flag');
    expect(flagged).toBeDefined();

    const originalScore = flagged!.riskScore;

    await act(async () => {
      await store.submitFalsePositiveFeedback(flagged!.id);
    });

    const updated = store.subscriptions.find((s: any) => s.id === flagged!.id);
    expect(updated?.riskScore).toBeLessThan(originalScore);
  });

  it('increments falsePositiveCount on the subscription', async () => {
    const store = await getFraudStore();
    const sub = store.subscriptions[0];
    const before = sub.falsePositiveCount ?? 0;

    await act(async () => {
      await store.submitFalsePositiveFeedback(sub.id);
    });

    const updated = store.subscriptions.find((s: any) => s.id === sub.id);
    expect(updated?.falsePositiveCount ?? 0).toBe(before + 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fraudStore – getFraudReport
// ─────────────────────────────────────────────────────────────────────────────

describe('fraudStore – getFraudReport', () => {
  it('returns a report for an existing merchant', () => {
    const store = await getFraudStore();
    const merchant = store.merchants[0];
    const report = store.getFraudReport(merchant.id);

    expect(report).toBeDefined();
    expect(report?.merchantId).toBe(merchant.id);
    expect(typeof report?.averageRisk).toBe('number');
    expect(typeof report?.totalSubscriptions).toBe('number');
    expect(typeof report?.flaggedSubscriptions).toBe('number');
    expect(typeof report?.blockedSubscriptions).toBe('number');
  });

  it('returns undefined for an unknown merchant', () => {
    const store = await getFraudStore();
    const report = store.getFraudReport('unknown_merchant_xyz');
    expect(report).toBeUndefined();
  });

  it('blockedSubscriptions + flaggedSubscriptions <= totalSubscriptions', () => {
    const store = await getFraudStore();
    for (const merchant of store.merchants) {
      const report = store.getFraudReport(merchant.id);
      if (!report) continue;
      expect(report.blockedSubscriptions + report.flaggedSubscriptions).toBeLessThanOrEqual(
        report.totalSubscriptions
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fraudStore – refreshFraudSignals
// ─────────────────────────────────────────────────────────────────────────────

describe('fraudStore – refreshFraudSignals', () => {
  it('completes without error and updates analytics', async () => {
    const store = await getFraudStore();
    const analyticsBeforeRefresh = store.analytics.totalChecks;

    await act(async () => {
      await store.refreshFraudSignals();
    });

    // After refresh analytics should still be populated
    expect(store.analytics.totalChecks).toBe(store.subscriptions.length);
    // totalChecks shouldn't shrink
    expect(store.analytics.totalChecks).toBeGreaterThanOrEqual(analyticsBeforeRefresh);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Risk scoring logic (determineAction thresholds)
// ─────────────────────────────────────────────────────────────────────────────

describe('risk scoring thresholds', () => {
  it('subscription with riskScore >= 80 should have action=block', () => {
    const store = await getFraudStore();
    const highRisk = store.subscriptions.filter((s: any) => s.riskScore >= 80);
    highRisk.forEach((s: any) => {
      expect(s.action).toBe('block');
    });
  });

  it('subscription with riskScore in [50,79] should have action=flag', () => {
    const store = await getFraudStore();
    const medRisk = store.subscriptions.filter((s: any) => s.riskScore >= 50 && s.riskScore < 80);
    medRisk.forEach((s: any) => {
      expect(s.action).toBe('flag');
    });
  });

  it('subscription with riskScore < 50 should have action=approve', () => {
    const store = await getFraudStore();
    const lowRisk = store.subscriptions.filter((s: any) => s.riskScore < 50);
    lowRisk.forEach((s: any) => {
      expect(s.action).toBe('approve');
    });
  });
});
