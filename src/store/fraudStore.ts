import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FraudAction,
  FraudAnalytics,
  FraudCase,
  FraudMerchantRecord,
  FraudReport,
  FraudRiskScore,
  FraudSignal,
  FraudSubscriptionRecord,
} from '../types/fraud';

const STORAGE_KEY = 'subtrackr-fraud-store';

const nowIso = () => new Date().toISOString();

const merchantSeeds: FraudMerchantRecord[] = [
  {
    id: 'merch_nova',
    name: 'Nova Stream',
    status: 'watch',
    activeSubscriptions: 128,
    blockedSubscriptions: 4,
    averageRisk: 41,
    monthlyVolume: 18650,
  },
  {
    id: 'merch_orbit',
    name: 'Orbit Tools',
    status: 'healthy',
    activeSubscriptions: 83,
    blockedSubscriptions: 1,
    averageRisk: 22,
    monthlyVolume: 9420,
  },
  {
    id: 'merch_cipher',
    name: 'Cipher Pro',
    status: 'high-risk',
    activeSubscriptions: 46,
    blockedSubscriptions: 9,
    averageRisk: 67,
    monthlyVolume: 7825,
  },
];

const subscriptionSeeds: FraudSubscriptionRecord[] = [
  {
    id: 'fraud_sub_1',
    merchantId: 'merch_nova',
    merchantName: 'Nova Stream',
    subscriberId: 'sub_ada',
    subscriptionName: 'Studio Plan',
    currency: 'USD',
    amount: 29,
    createdAt: '2026-04-22T09:00:00.000Z',
    expectedUsage: 8,
    observedUsage: 25,
    chargebacks: 0,
    riskScore: 78,
    action: 'flag',
    reason: 'Usage burst and fast creation cadence',
    usagePattern: 'burst',
    signals: [
      {
        kind: 'velocity',
        score: 28,
        detail: 'Created alongside two other subscriptions',
        observedAt: nowIso(),
      },
      {
        kind: 'usage-anomaly',
        score: 30,
        detail: 'Observed usage is 3x the expected baseline',
        observedAt: nowIso(),
      },
      {
        kind: 'chargeback',
        score: 20,
        detail: 'Recent dispute behavior is elevated',
        observedAt: nowIso(),
      },
    ],
    isBlocked: false,
    isFlagged: true,
  },
  {
    id: 'fraud_sub_2',
    merchantId: 'merch_nova',
    merchantName: 'Nova Stream',
    subscriberId: 'sub_ada',
    subscriptionName: 'Team Analytics',
    currency: 'USD',
    amount: 59,
    createdAt: '2026-04-22T11:10:00.000Z',
    expectedUsage: 10,
    observedUsage: 6,
    chargebacks: 1,
    riskScore: 84,
    action: 'block',
    reason: 'Chargeback history and rapid subscription creation',
    usagePattern: 'erratic',
    signals: [
      {
        kind: 'velocity',
        score: 35,
        detail: 'Second subscription within the same day',
        observedAt: nowIso(),
      },
      {
        kind: 'chargeback',
        score: 35,
        detail: 'Chargeback history predicts blocked outcome',
        observedAt: nowIso(),
      },
    ],
    isBlocked: true,
    isFlagged: true,
  },
  {
    id: 'fraud_sub_3',
    merchantId: 'merch_orbit',
    merchantName: 'Orbit Tools',
    subscriberId: 'sub_mina',
    subscriptionName: 'Pro Builder',
    currency: 'USD',
    amount: 19,
    createdAt: '2026-04-18T08:30:00.000Z',
    expectedUsage: 12,
    observedUsage: 12,
    chargebacks: 0,
    riskScore: 18,
    action: 'approve',
    reason: 'Usage profile is stable',
    usagePattern: 'normal',
    signals: [
      {
        kind: 'velocity',
        score: 6,
        detail: 'Low velocity but within threshold',
        observedAt: nowIso(),
      },
    ],
    isBlocked: false,
    isFlagged: false,
  },
  {
    id: 'fraud_sub_4',
    merchantId: 'merch_cipher',
    merchantName: 'Cipher Pro',
    subscriberId: 'sub_jon',
    subscriptionName: 'Automation Pack',
    currency: 'USD',
    amount: 99,
    createdAt: '2026-04-24T07:00:00.000Z',
    expectedUsage: 4,
    observedUsage: 19,
    chargebacks: 2,
    riskScore: 92,
    action: 'block',
    reason: 'Chargeback prediction and anomalous usage behavior',
    usagePattern: 'burst',
    signals: [
      {
        kind: 'usage-anomaly',
        score: 30,
        detail: 'Observed usage is far above baseline',
        observedAt: nowIso(),
      },
      {
        kind: 'chargeback',
        score: 35,
        detail: 'Repeated disputes indicate high risk',
        observedAt: nowIso(),
      },
      {
        kind: 'velocity',
        score: 27,
        detail: 'Fast subscription creation detected',
        observedAt: nowIso(),
      },
    ],
    isBlocked: true,
    isFlagged: true,
  },
];

const reviewSeeds: FraudCase[] = [
  {
    caseId: 'fraud_sub_1',
    subscriptionId: 'fraud_sub_1',
    subscriberId: 'sub_ada',
    merchantId: 'merch_nova',
    merchantName: 'Nova Stream',
    subscriptionName: 'Studio Plan',
    riskScore: 78,
    action: 'flag',
    status: 'pending',
    reason: 'Usage burst and fast creation cadence',
    createdAt: '2026-04-22T09:05:00.000Z',
    updatedAt: '2026-04-22T09:05:00.000Z',
    notes: 'Auto-flagged for analyst review',
  },
  {
    caseId: 'fraud_sub_2',
    subscriptionId: 'fraud_sub_2',
    subscriberId: 'sub_ada',
    merchantId: 'merch_nova',
    merchantName: 'Nova Stream',
    subscriptionName: 'Team Analytics',
    riskScore: 84,
    action: 'block',
    status: 'escalated',
    reason: 'Chargeback history and rapid subscription creation',
    createdAt: '2026-04-22T11:15:00.000Z',
    updatedAt: '2026-04-22T11:15:00.000Z',
    notes: 'Blocked automatically',
  },
  {
    caseId: 'fraud_sub_4',
    subscriptionId: 'fraud_sub_4',
    subscriberId: 'sub_jon',
    merchantId: 'merch_cipher',
    merchantName: 'Cipher Pro',
    subscriptionName: 'Automation Pack',
    riskScore: 92,
    action: 'block',
    status: 'escalated',
    reason: 'Chargeback prediction and anomalous usage behavior',
    createdAt: '2026-04-24T07:05:00.000Z',
    updatedAt: '2026-04-24T07:05:00.000Z',
    notes: 'High confidence block',
  },
];

const averageRisk = (items: FraudSubscriptionRecord[]): number =>
  items.length
    ? Math.round(items.reduce((sum, item) => sum + item.riskScore, 0) / items.length)
    : 0;

const computeAnalytics = (
  subscriptions: FraudSubscriptionRecord[],
  reviewQueue: FraudCase[]
): FraudAnalytics => {
  const approved = subscriptions.filter((item) => item.action === 'approve').length;
  const flagged = subscriptions.filter((item) => item.action === 'flag').length;
  const blocked = subscriptions.filter((item) => item.action === 'block').length;
  const velocityAlerts = subscriptions.filter((item) =>
    item.signals.some((signal) => signal.kind === 'velocity')
  ).length;
  const anomalyAlerts = subscriptions.filter((item) =>
    item.signals.some((signal) => signal.kind === 'usage-anomaly')
  ).length;
  const chargebackPredictions = subscriptions.filter((item) =>
    item.signals.some((signal) => signal.kind === 'chargeback')
  ).length;

  return {
    totalChecks: subscriptions.length,
    approved,
    flagged,
    blocked,
    manualReviews: reviewQueue.length,
    avgRisk: averageRisk(subscriptions),
    velocityAlerts,
    anomalyAlerts,
    chargebackPredictions,
    falsePositiveEstimate: Math.max(0, Math.round(flagged * 0.18)),
  };
};

const scoreSubscription = (item: FraudSubscriptionRecord): FraudRiskScore => ({
  subscriberId: item.subscriberId,
  subscriptionId: item.id,
  merchantId: item.merchantId,
  merchantName: item.merchantName,
  totalScore: item.riskScore,
  velocityScore: item.signals.find((signal) => signal.kind === 'velocity')?.score ?? 0,
  anomalyScore: item.signals.find((signal) => signal.kind === 'usage-anomaly')?.score ?? 0,
  chargebackScore: item.signals.find((signal) => signal.kind === 'chargeback')?.score ?? 0,
  action: item.action,
  reason: item.reason,
  assessedAt: item.createdAt,
  signals: item.signals,
});

const cloneCase = (entry: FraudCase): FraudCase => ({ ...entry, notes: entry.notes });

interface FraudState {
  merchants: FraudMerchantRecord[];
  subscriptions: FraudSubscriptionRecord[];
  assessments: FraudRiskScore[];
  reviewQueue: FraudCase[];
  analytics: FraudAnalytics;
  loading: boolean;
  error: string | null;
  refreshFraudSignals: () => void;
  assessRisk: (subscriberId: string) => FraudRiskScore[];
  flagSubscription: (subscriptionId: string) => void;
  approveSubscription: (subscriptionId: string) => void;
  blockSubscription: (subscriptionId: string) => void;
  resolveCase: (subscriptionId: string, action: FraudAction) => void;
  getFraudReport: (merchantId: string) => FraudReport;
}

const hydrateAssessments = (subscriptions: FraudSubscriptionRecord[]): FraudRiskScore[] =>
  subscriptions.map((item) => scoreSubscription(item));

const hydrateReviewQueue = (reviews: FraudCase[]): FraudCase[] => reviews.map(cloneCase);

const updateSubscription = (
  subscriptions: FraudSubscriptionRecord[],
  subscriptionId: string,
  patch: Partial<FraudSubscriptionRecord>
): FraudSubscriptionRecord[] =>
  subscriptions.map((item) => (item.id === subscriptionId ? { ...item, ...patch } : item));

const buildMerchantReport = (
  merchants: FraudMerchantRecord[],
  subscriptions: FraudSubscriptionRecord[],
  reviewQueue: FraudCase[],
  merchantId: string
): FraudReport => {
  const merchant = merchants.find((item) => item.id === merchantId);
  const merchantName = merchant?.name ?? 'Unknown merchant';
  const scoped = subscriptions.filter((item) => item.merchantId === merchantId);
  const scopedCases = reviewQueue.filter((entry) => entry.merchantId === merchantId);

  return {
    merchantId,
    merchantName,
    totalSubscriptions: scoped.length,
    flaggedSubscriptions: scoped.filter((item) => item.action === 'flag').length,
    blockedSubscriptions: scoped.filter((item) => item.action === 'block').length,
    manualReviewCount: scopedCases.filter((item) => item.status !== 'reviewed').length,
    averageRisk: averageRisk(scoped),
    velocityAlerts: scoped.filter((item) =>
      item.signals.some((signal) => signal.kind === 'velocity')
    ).length,
    anomalyAlerts: scoped.filter((item) =>
      item.signals.some((signal) => signal.kind === 'usage-anomaly')
    ).length,
    chargebackPredictions: scoped.filter((item) =>
      item.signals.some((signal) => signal.kind === 'chargeback')
    ).length,
    highRiskSubscribers: new Set(
      scoped.filter((item) => item.riskScore >= 50).map((item) => item.subscriberId)
    ).size,
    recentCases: scopedCases.slice(0, 5),
  };
};

export const useFraudStore = create<FraudState>()(
  persist(
    (set, get) => ({
      merchants: merchantSeeds.map((merchant) => ({ ...merchant })),
      subscriptions: subscriptionSeeds.map((item) => ({
        ...item,
        signals: item.signals.map((signal) => ({ ...signal })),
      })),
      assessments: hydrateAssessments(subscriptionSeeds),
      reviewQueue: hydrateReviewQueue(reviewSeeds),
      analytics: computeAnalytics(subscriptionSeeds, reviewSeeds),
      loading: false,
      error: null,

      refreshFraudSignals: () => {
        const { subscriptions, reviewQueue, merchants } = get();
        set({
          analytics: computeAnalytics(subscriptions, reviewQueue),
          assessments: hydrateAssessments(subscriptions),
          merchants: merchants.map((merchant) => ({
            ...merchant,
            averageRisk: buildMerchantReport(merchants, subscriptions, reviewQueue, merchant.id)
              .averageRisk,
            blockedSubscriptions: buildMerchantReport(
              merchants,
              subscriptions,
              reviewQueue,
              merchant.id
            ).blockedSubscriptions,
            activeSubscriptions: buildMerchantReport(
              merchants,
              subscriptions,
              reviewQueue,
              merchant.id
            ).totalSubscriptions,
            status:
              buildMerchantReport(merchants, subscriptions, reviewQueue, merchant.id).averageRisk >=
              60
                ? 'high-risk'
                : buildMerchantReport(merchants, subscriptions, reviewQueue, merchant.id)
                      .averageRisk >= 35
                  ? 'watch'
                  : 'healthy',
          })),
        });
      },

      assessRisk: (subscriberId: string) => {
        const assessments = get()
          .subscriptions.filter((item) => item.subscriberId === subscriberId)
          .map((item) => scoreSubscription(item));

        set((state) => ({
          assessments: [
            ...state.assessments.filter((item) => item.subscriberId !== subscriberId),
            ...assessments,
          ],
          analytics: computeAnalytics(state.subscriptions, state.reviewQueue),
        }));

        return assessments;
      },

      flagSubscription: (subscriptionId: string) => {
        const current = get().subscriptions.find((item) => item.id === subscriptionId);
        if (!current) return;

        const score = scoreSubscription(current);
        const nextCase: FraudCase = {
          caseId: subscriptionId,
          subscriptionId,
          subscriberId: current.subscriberId,
          merchantId: current.merchantId,
          merchantName: current.merchantName,
          subscriptionName: current.subscriptionName,
          riskScore: score.totalScore,
          action: score.totalScore >= 80 ? 'block' : 'flag',
          status: score.totalScore >= 80 ? 'escalated' : 'pending',
          reason: score.reason,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          notes: 'Manually queued for analyst review',
        };

        set((state) => ({
          subscriptions: updateSubscription(state.subscriptions, subscriptionId, {
            action: nextCase.action,
            isFlagged: true,
            isBlocked: nextCase.action === 'block',
          }),
          reviewQueue: [
            nextCase,
            ...state.reviewQueue.filter((entry) => entry.subscriptionId !== subscriptionId),
          ],
          analytics: computeAnalytics(
            updateSubscription(state.subscriptions, subscriptionId, {
              action: nextCase.action,
              isFlagged: true,
              isBlocked: nextCase.action === 'block',
            }),
            [
              nextCase,
              ...state.reviewQueue.filter((entry) => entry.subscriptionId !== subscriptionId),
            ]
          ),
        }));
      },

      approveSubscription: (subscriptionId: string) => {
        set((state) => {
          const subscriptions = updateSubscription(state.subscriptions, subscriptionId, {
            action: 'approve',
            isFlagged: false,
            isBlocked: false,
          });
          const reviewQueue = state.reviewQueue.map((entry) =>
            entry.subscriptionId === subscriptionId
              ? { ...entry, status: 'reviewed', action: 'approve', updatedAt: nowIso() }
              : entry
          );
          return {
            subscriptions,
            reviewQueue,
            analytics: computeAnalytics(subscriptions, reviewQueue),
          };
        });
      },

      blockSubscription: (subscriptionId: string) => {
        set((state) => {
          const subscriptions = updateSubscription(state.subscriptions, subscriptionId, {
            action: 'block',
            isFlagged: true,
            isBlocked: true,
          });
          const reviewQueue = state.reviewQueue.map((entry) =>
            entry.subscriptionId === subscriptionId
              ? { ...entry, status: 'escalated', action: 'block', updatedAt: nowIso() }
              : entry
          );
          return {
            subscriptions,
            reviewQueue,
            analytics: computeAnalytics(subscriptions, reviewQueue),
          };
        });
      },

      resolveCase: (subscriptionId: string, action: FraudAction) => {
        set((state) => {
          const subscriptions = updateSubscription(state.subscriptions, subscriptionId, {
            action,
            isFlagged: action !== 'approve',
            isBlocked: action === 'block',
          });
          const reviewQueue = state.reviewQueue.map((entry) =>
            entry.subscriptionId === subscriptionId
              ? {
                  ...entry,
                  action,
                  status:
                    action === 'approve'
                      ? 'reviewed'
                      : action === 'block'
                        ? 'escalated'
                        : 'pending',
                  updatedAt: nowIso(),
                }
              : entry
          );
          return {
            subscriptions,
            reviewQueue,
            analytics: computeAnalytics(subscriptions, reviewQueue),
          };
        });
      },

      getFraudReport: (merchantId: string) =>
        buildMerchantReport(get().merchants, get().subscriptions, get().reviewQueue, merchantId),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
