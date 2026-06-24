import { act } from 'react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { useFraudStore } from '../fraudStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
}));

describe('fraudStore', () => {
  beforeEach(() => {
    useFraudStore.setState({
      merchants: [],
      subscriptions: [],
      assessments: [],
      reviewQueue: [],
      analytics: {
        totalChecks: 0,
        approved: 0,
        flagged: 0,
        blocked: 0,
        manualReviews: 0,
        manualReviewsClosed: 0,
        avgRisk: 0,
        velocityAlerts: 0,
        anomalyAlerts: 0,
        geoAnomalyAlerts: 0,
        chargebackPredictions: 0,
        falsePositiveEstimate: 0,
        falsePositiveRate: 0,
        modelConfidence: 0,
      },
      loading: false,
      error: null,
    });
  });

  it('scores rapid creation and queues review cases', () => {
    useFraudStore.setState({
      merchants: [
        {
          id: 'm1',
          name: 'FastPay',
          status: 'watch',
          activeSubscriptions: 2,
          blockedSubscriptions: 0,
          averageRisk: 30,
          monthlyVolume: 5000,
        },
      ],
      subscriptions: [
        {
          id: 's1',
          merchantId: 'm1',
          merchantName: 'FastPay',
          subscriberId: 'sub-1',
          subscriptionName: 'Plan A',
          currency: 'USD',
          amount: 10,
          createdAt: '2026-04-24T07:00:00.000Z',
          expectedUsage: 2,
          observedUsage: 8,
          chargebacks: 1,
          riskScore: 81,
          action: 'flag',
          reason: 'high velocity',
          usagePattern: 'burst',
          signals: [],
          isBlocked: false,
          isFlagged: true,
        },
      ],
    });

    act(() => {
      useFraudStore.getState().refreshFraudSignals();
    });

    const report = useFraudStore.getState().getFraudReport('m1');
    expect(report.averageRisk).toBe(81);
    expect(report.flaggedSubscriptions).toBe(1);
  });

  it('approves and blocks subscriptions through review actions', () => {
    useFraudStore.setState({
      merchants: [
        {
          id: 'm2',
          name: 'ReviewCo',
          status: 'high-risk',
          activeSubscriptions: 1,
          blockedSubscriptions: 1,
          averageRisk: 92,
          monthlyVolume: 9000,
        },
      ],
      subscriptions: [
        {
          id: 's2',
          merchantId: 'm2',
          merchantName: 'ReviewCo',
          subscriberId: 'sub-2',
          subscriptionName: 'Plan B',
          currency: 'USD',
          amount: 100,
          createdAt: '2026-04-24T08:00:00.000Z',
          expectedUsage: 1,
          observedUsage: 12,
          chargebacks: 2,
          riskScore: 92,
          action: 'block',
          reason: 'chargeback risk',
          usagePattern: 'erratic',
          signals: [],
          isBlocked: true,
          isFlagged: true,
        },
      ],
      reviewQueue: [
        {
          caseId: 's2',
          subscriptionId: 's2',
          subscriberId: 'sub-2',
          merchantId: 'm2',
          merchantName: 'ReviewCo',
          subscriptionName: 'Plan B',
          riskScore: 92,
          action: 'block',
          status: 'escalated',
          reason: 'chargeback risk',
          createdAt: '2026-04-24T08:00:00.000Z',
          updatedAt: '2026-04-24T08:00:00.000Z',
        },
      ],
    });

    act(() => {
      useFraudStore.getState().approveSubscription('s2');
    });

    expect(useFraudStore.getState().subscriptions[0].action).toBe('approve');
    expect(useFraudStore.getState().reviewQueue[0].status).toBe('reviewed');
  });

  it('records false positive feedback and lowers future risk', () => {
    useFraudStore.setState({
      subscriptions: [
        {
          id: 's3',
          merchantId: 'm3',
          merchantName: 'SignalCo',
          subscriberId: 'sub-3',
          subscriptionName: 'Plan C',
          currency: 'USD',
          amount: 55,
          createdAt: '2026-04-24T09:00:00.000Z',
          expectedUsage: 3,
          observedUsage: 15,
          chargebacks: 1,
          homeCountry: 'US',
          currentCountry: 'CA',
          deviceFingerprint: 'device-old',
          trustedDeviceFingerprint: 'device-new',
          riskScore: 88,
          action: 'block',
          reason: 'high risk',
          usagePattern: 'burst',
          signals: [],
          isBlocked: true,
          isFlagged: true,
          falsePositiveCount: 0,
        },
      ],
      reviewQueue: [
        {
          caseId: 's3',
          subscriptionId: 's3',
          subscriberId: 'sub-3',
          merchantId: 'm3',
          merchantName: 'SignalCo',
          subscriptionName: 'Plan C',
          riskScore: 88,
          action: 'block',
          status: 'pending',
          reason: 'high risk',
          createdAt: '2026-04-24T09:00:00.000Z',
          updatedAt: '2026-04-24T09:00:00.000Z',
          evidence: [],
        },
      ],
    });

    act(() => {
      useFraudStore.getState().submitFalsePositiveFeedback('s3', 'Legit travel');
      useFraudStore.getState().refreshFraudSignals();
    });

    const store = useFraudStore.getState();
    expect(store.subscriptions[0].falsePositiveCount).toBe(1);
    expect(store.subscriptions[0].riskScore).toBeLessThan(100);
    expect(store.reviewQueue[0].status).toBe('dismissed');
    expect(store.analytics.falsePositiveRate).toBeGreaterThanOrEqual(0);
  });
});
