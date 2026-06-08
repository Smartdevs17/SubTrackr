import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  FraudAction,
  FraudAnalytics,
  FraudCase,
  FraudEvidence,
  FraudMerchantRecord,
  FraudReport,
  FraudRiskScore,
  FraudReviewStatus,
  FraudSubscriptionRecord,
  FraudSignal,
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
    homeCountry: 'NG',
    currentCountry: 'GH',
    deviceFingerprint: 'device-ada-lagos',
    trustedDeviceFingerprint: 'device-ada-lagos',
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
    homeCountry: 'NG',
    currentCountry: 'NG',
    deviceFingerprint: 'device-ada-travel',
    trustedDeviceFingerprint: 'device-ada-lagos',
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
    homeCountry: 'GH',
    currentCountry: 'GH',
    deviceFingerprint: 'device-mina-1',
    trustedDeviceFingerprint: 'device-mina-1',
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
    homeCountry: 'KE',
    currentCountry: 'UA',
    deviceFingerprint: 'device-jon-vpn',
    trustedDeviceFingerprint: 'device-jon-office',
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
    evidence: [],
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
    evidence: [],
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
    evidence: [],
  },
];

const averageRisk = (items: FraudSubscriptionRecord[]): number =>
  items.length
    ? Math.round(items.reduce((sum, item) => sum + item.riskScore, 0) / items.length)
    : 0;

const cloneSignal = (signal: FraudSignal): FraudSignal => ({ ...signal });

const cloneEvidence = (evidence: FraudEvidence): FraudEvidence => ({ ...evidence });

const cloneCase = (entry: FraudCase): FraudCase => ({
  ...entry,
  evidence: entry.evidence?.map(cloneEvidence),
});

const dedupeSignals = (signals: FraudSignal[]): FraudSignal[] => {
  const byKind = new Map<FraudSignal['kind'], FraudSignal>();
  signals.forEach((signal) => {
    const existing = byKind.get(signal.kind);
    if (!existing || signal.score >= existing.score) {
      byKind.set(signal.kind, signal);
    }
  });
  return Array.from(byKind.values()).sort((left, right) => right.score - left.score);
};

const countVelocitySignals = (
  item: FraudSubscriptionRecord,
  subscriptions: FraudSubscriptionRecord[]
): number => {
  const sameSubscriber = subscriptions.filter(
    (candidate) => candidate.subscriberId === item.subscriberId
  );
  const recentWindow = sameSubscriber.filter((candidate) => {
    const createdAt = new Date(candidate.createdAt).getTime();
    const current = new Date(item.createdAt).getTime();
    return (
      Number.isFinite(createdAt) &&
      Number.isFinite(current) &&
      Math.abs(current - createdAt) <= 24 * 60 * 60 * 1000
    );
  });

  return recentWindow.length > 2 ? 24 : recentWindow.length > 1 ? 14 : 0;
};

const determineAction = (score: number): FraudAction => {
  if (score >= 80) {
    return 'block';
  }

  if (score >= 50) {
    return 'flag';
  }

  return 'approve';
};

const buildDerivedSignals = (
  item: FraudSubscriptionRecord,
  subscriptions: FraudSubscriptionRecord[]
): FraudSignal[] => {
  const derived: FraudSignal[] = [];

  const velocityScore = countVelocitySignals(item, subscriptions);
  if (velocityScore > 0) {
    derived.push({
      kind: 'velocity',
      score: velocityScore,
      detail: 'subscription creation velocity is above the safe threshold',
      observedAt: nowIso(),
    });
  }

  if (item.expectedUsage > 0 && item.observedUsage >= item.expectedUsage * 3) {
    derived.push({
      kind: 'usage-anomaly',
      score: 32,
      detail: 'observed usage is more than 3x the expected baseline',
      observedAt: nowIso(),
    });
  } else if (item.expectedUsage > 0 && item.observedUsage >= item.expectedUsage * 2) {
    derived.push({
      kind: 'usage-anomaly',
      score: 22,
      detail: 'observed usage is more than 2x the expected baseline',
      observedAt: nowIso(),
    });
  }

  if ((item.chargebacks ?? 0) > 0) {
    derived.push({
      kind: 'chargeback',
      score: Math.min(18 + item.chargebacks * 12, 40),
      detail: 'chargeback history predicts dispute exposure',
      observedAt: nowIso(),
    });
  }

  if (item.homeCountry && item.currentCountry && item.homeCountry !== item.currentCountry) {
    derived.push({
      kind: 'geolocation-anomaly',
      score: 24,
      detail: `${item.currentCountry} activity differs from the normal ${item.homeCountry} profile`,
      observedAt: nowIso(),
    });
  }

  if (
    item.deviceFingerprint &&
    item.trustedDeviceFingerprint &&
    item.deviceFingerprint !== item.trustedDeviceFingerprint
  ) {
    derived.push({
      kind: 'device-mismatch',
      score: 20,
      detail: 'device fingerprint does not match the trusted profile',
      observedAt: nowIso(),
    });
  }

  if (
    item.usagePattern === 'burst' &&
    derived.some(
      (signal) => signal.kind === 'geolocation-anomaly' || signal.kind === 'device-mismatch'
    )
  ) {
    derived.push({
      kind: 'pattern-shift',
      score: 16,
      detail: 'burst usage combined with travel or device drift suggests a pattern shift',
      observedAt: nowIso(),
    });
  }

  return dedupeSignals([...item.signals.map(cloneSignal), ...derived]);
};

const scoreSubscription = (
  item: FraudSubscriptionRecord,
  subscriptions: FraudSubscriptionRecord[] = []
): FraudRiskScore => {
  const signals = buildDerivedSignals(item, subscriptions);
  const velocityScore = signals.find((signal) => signal.kind === 'velocity')?.score ?? 0;
  const anomalyScore = signals.find((signal) => signal.kind === 'usage-anomaly')?.score ?? 0;
  const chargebackScore = signals.find((signal) => signal.kind === 'chargeback')?.score ?? 0;
  const geoScore = signals.find((signal) => signal.kind === 'geolocation-anomaly')?.score ?? 0;
  const deviceScore = signals.find((signal) => signal.kind === 'device-mismatch')?.score ?? 0;
  const patternShiftScore = signals.find((signal) => signal.kind === 'pattern-shift')?.score ?? 0;
  const falsePositivePenalty = Math.min((item.falsePositiveCount ?? 0) * 40, 60);
  const totalScore = Math.max(
    0,
    Math.min(
      100,
      velocityScore +
        anomalyScore +
        chargebackScore +
        geoScore +
        deviceScore +
        patternShiftScore -
        falsePositivePenalty
    )
  );

  const evidence: FraudEvidence[] = [
    {
      evidenceId: `${item.id}-payment`,
      label: 'Payment profile',
      value: `${item.currency} ${item.amount.toFixed(2)}`,
      source: 'payment',
      capturedAt: item.createdAt,
      confidence: 0.88,
    },
    ...(item.homeCountry && item.currentCountry && item.homeCountry !== item.currentCountry
      ? [
          {
            evidenceId: `${item.id}-geo`,
            label: 'Location drift',
            value: `${item.homeCountry} -> ${item.currentCountry}`,
            source: 'location',
            capturedAt: item.lastSeenAt ?? nowIso(),
            confidence: 0.92,
          } as FraudEvidence,
        ]
      : []),
    ...(item.deviceFingerprint &&
    item.trustedDeviceFingerprint &&
    item.deviceFingerprint !== item.trustedDeviceFingerprint
      ? [
          {
            evidenceId: `${item.id}-device`,
            label: 'Device mismatch',
            value: `${item.trustedDeviceFingerprint} != ${item.deviceFingerprint}`,
            source: 'device',
            capturedAt: item.lastSeenAt ?? nowIso(),
            confidence: 0.87,
          } as FraudEvidence,
        ]
      : []),
  ];

  const reason =
    geoScore >= chargebackScore && geoScore >= anomalyScore && geoScore >= velocityScore
      ? 'Geolocation anomaly is the dominant signal'
      : deviceScore > chargebackScore && deviceScore >= anomalyScore
        ? 'Device fingerprint drift drove the score'
        : chargebackScore >= anomalyScore && chargebackScore >= velocityScore
          ? 'Chargeback risk dominates'
          : velocityScore >= anomalyScore
            ? 'Velocity risk is elevated'
            : 'Usage anomaly detected';

  return {
    subscriberId: item.subscriberId,
    subscriptionId: item.id,
    merchantId: item.merchantId,
    merchantName: item.merchantName,
    totalScore,
    velocityScore,
    anomalyScore,
    chargebackScore,
    action: determineAction(totalScore),
    reason,
    assessedAt: nowIso(),
    signals,
    evidence,
  };
};

const computeAnalytics = (
  subscriptions: FraudSubscriptionRecord[],
  reviewQueue: FraudCase[]
): FraudAnalytics => {
  const scores = subscriptions.map((item) => scoreSubscription(item, subscriptions));
  const approved = subscriptions.filter((item) => item.action === 'approve').length;
  const flagged = subscriptions.filter((item) => item.action === 'flag').length;
  const blocked = subscriptions.filter((item) => item.action === 'block').length;
  const velocityAlerts = scores.filter((item) => item.velocityScore > 0).length;
  const anomalyAlerts = scores.filter((item) => item.anomalyScore > 0).length;
  const geoAnomalyAlerts = scores.filter((item) =>
    item.signals.some((signal) => signal.kind === 'geolocation-anomaly')
  ).length;
  const chargebackPredictions = scores.filter((item) => item.chargebackScore > 0).length;
  const manualReviewsClosed = reviewQueue.filter(
    (item) => item.status === 'reviewed' || item.status === 'dismissed'
  ).length;
  const falsePositiveCount = reviewQueue.filter((item) => item.outcome === 'false_positive').length;
  const modelConfidence = Math.max(0, 100 - Math.min(falsePositiveCount * 8, 40));

  return {
    totalChecks: subscriptions.length,
    approved,
    flagged,
    blocked,
    manualReviews: reviewQueue.length,
    manualReviewsClosed,
    avgRisk: averageRisk(subscriptions),
    velocityAlerts,
    anomalyAlerts,
    geoAnomalyAlerts,
    chargebackPredictions,
    falsePositiveEstimate: Math.max(0, Math.round((flagged + blocked) * 0.18)),
    falsePositiveRate:
      manualReviewsClosed > 0 ? Math.round((falsePositiveCount / manualReviewsClosed) * 100) : 0,
    modelConfidence,
  };
};

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
  submitFalsePositiveFeedback: (subscriptionId: string, notes?: string) => void;
  getFraudReport: (merchantId: string) => FraudReport;
}

const hydrateAssessments = (subscriptions: FraudSubscriptionRecord[]): FraudRiskScore[] =>
  subscriptions.map((item) => scoreSubscription(item, subscriptions));

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
  const scoredScoped = scoped.map((item) => scoreSubscription(item, scoped));

  return {
    merchantId,
    merchantName,
    totalSubscriptions: scoped.length,
    flaggedSubscriptions: scoped.filter((item) => item.action === 'flag').length,
    blockedSubscriptions: scoped.filter((item) => item.action === 'block').length,
    manualReviewCount: scopedCases.filter((item) => item.status !== 'reviewed').length,
    averageRisk: averageRisk(scoped),
    velocityAlerts: scoredScoped.filter((item) => item.velocityScore > 0).length,
    anomalyAlerts: scoredScoped.filter((item) => item.anomalyScore > 0).length,
    chargebackPredictions: scoredScoped.filter((item) => item.chargebackScore > 0).length,
    highRiskSubscribers: new Set(
      scoredScoped.filter((item) => item.totalScore >= 50).map((item) => item.subscriberId)
    ).size,
    geolocationAlerts: scoredScoped.filter((item) =>
      item.signals.some((signal) => signal.kind === 'geolocation-anomaly')
    ).length,
    pendingEvidenceCount: scopedCases.filter((item) => (item.evidence?.length ?? 0) === 0).length,
    falsePositiveFeedbackCount: scopedCases.filter((item) => item.outcome === 'false_positive')
      .length,
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
        const rescored = subscriptions.map((item) => {
          const score = scoreSubscription(item, subscriptions);
          return {
            ...item,
            riskScore: score.totalScore,
            reason: score.reason,
            signals: score.signals,
            isFlagged: item.action !== 'approve',
            isBlocked: item.action === 'block',
            lastSeenAt: score.assessedAt,
            falsePositiveCount: item.falsePositiveCount ?? 0,
          };
        });
        set({
          subscriptions: rescored,
          analytics: computeAnalytics(rescored, reviewQueue),
          assessments: hydrateAssessments(rescored),
          merchants: merchants.map((merchant) => {
            const report = buildMerchantReport(merchants, rescored, reviewQueue, merchant.id);
            return {
              ...merchant,
              averageRisk: report.averageRisk,
              blockedSubscriptions: report.blockedSubscriptions,
              activeSubscriptions: report.totalSubscriptions,
              falsePositiveRate:
                report.totalSubscriptions > 0
                  ? report.falsePositiveFeedbackCount / report.totalSubscriptions
                  : 0,
              status:
                report.averageRisk >= 60
                  ? 'high-risk'
                  : report.averageRisk >= 35
                    ? 'watch'
                    : 'healthy',
            };
          }),
        });
      },

      assessRisk: (subscriberId: string) => {
        const subscriptions = get().subscriptions;
        const assessments = subscriptions
          .filter((item) => item.subscriberId === subscriberId)
          .map((item) => scoreSubscription(item, subscriptions));

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
        const subscriptions = get().subscriptions;
        const current = subscriptions.find((item) => item.id === subscriptionId);
        if (!current) return;

        const score = scoreSubscription(current, subscriptions);
        const action: FraudAction = score.totalScore >= 80 ? 'block' : 'flag';
        const status: FraudReviewStatus = score.totalScore >= 80 ? 'escalated' : 'pending';
        const nextCase: FraudCase = {
          caseId: subscriptionId,
          subscriptionId,
          subscriberId: current.subscriberId,
          merchantId: current.merchantId,
          merchantName: current.merchantName,
          subscriptionName: current.subscriptionName,
          riskScore: score.totalScore,
          action,
          status,
          reason: score.reason,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          notes: 'Manually queued for analyst review',
          evidence: score.evidence?.map(cloneEvidence),
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
          const reviewQueue = state.reviewQueue.map((entry) => {
            if (entry.subscriptionId !== subscriptionId) {
              return entry;
            }

            const reviewedCase: FraudCase = {
              ...entry,
              status: 'reviewed',
              action: 'approve',
              outcome: 'true_positive',
              reviewedAt: nowIso(),
              updatedAt: nowIso(),
            };
            return reviewedCase;
          });
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
          const reviewQueue = state.reviewQueue.map((entry) => {
            if (entry.subscriptionId !== subscriptionId) {
              return entry;
            }

            const escalatedCase: FraudCase = {
              ...entry,
              status: 'escalated',
              action: 'block',
              updatedAt: nowIso(),
            };
            return escalatedCase;
          });
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
          const reviewQueue = state.reviewQueue.map((entry) => {
            if (entry.subscriptionId !== subscriptionId) {
              return entry;
            }

            const resolvedCase: FraudCase = {
              ...entry,
              action,
              status:
                action === 'approve' ? 'reviewed' : action === 'block' ? 'escalated' : 'pending',
              updatedAt: nowIso(),
            };
            return resolvedCase;
          });
          return {
            subscriptions,
            reviewQueue,
            analytics: computeAnalytics(subscriptions, reviewQueue),
          };
        });
      },

      submitFalsePositiveFeedback: (subscriptionId: string, notes?: string) => {
        set((state) => {
          const subscriptions = updateSubscription(state.subscriptions, subscriptionId, {
            action: 'approve',
            isFlagged: false,
            isBlocked: false,
            falsePositiveCount:
              (state.subscriptions.find((item) => item.id === subscriptionId)?.falsePositiveCount ??
                0) + 1,
            lastSeenAt: nowIso(),
          });

          const reviewQueue = state.reviewQueue.map((entry) => {
            if (entry.subscriptionId !== subscriptionId) {
              return entry;
            }

            const dismissedCase: FraudCase = {
              ...entry,
              status: 'dismissed',
              action: 'approve',
              outcome: 'false_positive',
              reviewedAt: nowIso(),
              updatedAt: nowIso(),
              notes: notes ?? entry.notes ?? 'Marked as false positive',
            };
            return dismissedCase;
          });
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
