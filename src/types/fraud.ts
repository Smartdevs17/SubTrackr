export type FraudAction = 'approve' | 'flag' | 'block';
export type FraudReviewStatus = 'pending' | 'reviewed' | 'dismissed' | 'escalated';
export type FraudSignalType =
  | 'velocity'
  | 'usage-anomaly'
  | 'chargeback'
  | 'pattern-shift'
  | 'device-mismatch'
  | 'geolocation-anomaly';
export type FraudReviewOutcome = 'true_positive' | 'false_positive' | 'needs_follow_up';
export type FraudEvidenceSource = 'payment' | 'device' | 'location' | 'support';
  | 'device-mismatch';

export interface FraudSignal {
  kind: FraudSignalType;
  score: number;
  detail: string;
  observedAt: string;
}

export interface FraudEvidence {
  evidenceId: string;
  label: string;
  value: string;
  source: FraudEvidenceSource;
  capturedAt: string;
  confidence: number;
}

export interface FraudRiskScore {
  subscriberId: string;
  subscriptionId: string;
  merchantId: string;
  merchantName: string;
  totalScore: number;
  velocityScore: number;
  anomalyScore: number;
  chargebackScore: number;
  action: FraudAction;
  reason: string;
  assessedAt: string;
  signals: FraudSignal[];
  evidence?: FraudEvidence[];
}

export interface FraudCase {
  caseId: string;
  subscriptionId: string;
  subscriberId: string;
  merchantId: string;
  merchantName: string;
  subscriptionName: string;
  riskScore: number;
  action: FraudAction;
  status: FraudReviewStatus;
  reason: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  reviewer?: string;
  reviewedAt?: string;
  outcome?: FraudReviewOutcome;
  evidence?: FraudEvidence[];
}

export interface FraudReport {
  merchantId: string;
  merchantName: string;
  totalSubscriptions: number;
  flaggedSubscriptions: number;
  blockedSubscriptions: number;
  manualReviewCount: number;
  averageRisk: number;
  velocityAlerts: number;
  anomalyAlerts: number;
  chargebackPredictions: number;
  highRiskSubscribers: number;
  geolocationAlerts: number;
  pendingEvidenceCount: number;
  falsePositiveFeedbackCount: number;
  recentCases: FraudCase[];
}

export interface FraudSubscriptionRecord {
  id: string;
  merchantId: string;
  merchantName: string;
  subscriberId: string;
  subscriptionName: string;
  currency: string;
  amount: number;
  createdAt: string;
  expectedUsage: number;
  observedUsage: number;
  chargebacks: number;
  homeCountry?: string;
  currentCountry?: string;
  deviceFingerprint?: string;
  trustedDeviceFingerprint?: string;
  lastSeenAt?: string;
  falsePositiveCount?: number;
  riskScore: number;
  action: FraudAction;
  reason: string;
  usagePattern: 'normal' | 'burst' | 'erratic';
  signals: FraudSignal[];
  isBlocked: boolean;
  isFlagged: boolean;
}

export interface FraudMerchantRecord {
  id: string;
  name: string;
  status: 'healthy' | 'watch' | 'high-risk';
  activeSubscriptions: number;
  blockedSubscriptions: number;
  averageRisk: number;
  monthlyVolume: number;
  falsePositiveRate?: number;
}

export interface FraudAnalytics {
  totalChecks: number;
  approved: number;
  flagged: number;
  blocked: number;
  manualReviews: number;
  manualReviewsClosed: number;
  avgRisk: number;
  velocityAlerts: number;
  anomalyAlerts: number;
  geoAnomalyAlerts: number;
  chargebackPredictions: number;
  falsePositiveEstimate: number;
  falsePositiveRate: number;
  modelConfidence: number;
}
