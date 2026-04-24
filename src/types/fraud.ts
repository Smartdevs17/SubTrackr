export type FraudAction = 'approve' | 'flag' | 'block';
export type FraudReviewStatus = 'pending' | 'reviewed' | 'dismissed' | 'escalated';
export type FraudSignalType = 'velocity' | 'usage-anomaly' | 'chargeback' | 'pattern-shift' | 'device-mismatch';

export interface FraudSignal {
  kind: FraudSignalType;
  score: number;
  detail: string;
  observedAt: string;
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
}

export interface FraudAnalytics {
  totalChecks: number;
  approved: number;
  flagged: number;
  blocked: number;
  manualReviews: number;
  avgRisk: number;
  velocityAlerts: number;
  anomalyAlerts: number;
  chargebackPredictions: number;
  falsePositiveEstimate: number;
}
