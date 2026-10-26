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

// ── Legacy types used by fraudDetectionService ────────────────────────────────

export type FraudRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export enum FraudStatus {
  PENDING = 'pending',
  REVIEWED = 'reviewed',
  CONFIRMED = 'confirmed',
  FALSE_POSITIVE = 'false_positive',
  DISMISSED = 'dismissed',
}

export enum FraudDetectionMethod {
  VELOCITY_CHECK = 'velocity_check',
  PATTERN_ANALYSIS = 'pattern_analysis',
  GEOLOCATION = 'geolocation',
  DEVICE_FINGERPRINT = 'device_fingerprint',
  AMOUNT_ANOMALY = 'amount_anomaly',
  BEHAVIORAL = 'behavioral',
  NETWORK_ANALYSIS = 'network_analysis',
  ML_MODEL = 'ml_model',
}

export enum FraudIndicatorType {
  RAPID_TRANSACTIONS = 'rapid_transactions',
  UNUSUAL_AMOUNT = 'unusual_amount',
  LOCATION_MISMATCH = 'location_mismatch',
  NEW_DEVICE = 'new_device',
  SUSPICIOUS_PATTERN = 'suspicious_pattern',
  MULTIPLE_FAILED_ATTEMPTS = 'multiple_failed_attempts',
  VELOCITY_EXCEEDED = 'velocity_exceeded',
  BLACKLISTED = 'blacklisted',
  UNUSUAL_TIME = 'unusual_time',
  IP_REPUTATION = 'ip_reputation',
}

export interface FraudIndicator {
  type: FraudIndicatorType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  value?: string | number;
  threshold?: number;
}

export interface FraudDetection {
  id: string;
  transactionId: string;
  subscriptionId: string;
  userId: string;
  timestamp: Date;
  riskScore: number;
  riskLevel: FraudRiskLevel;
  detectionMethod: FraudDetectionMethod;
  indicators: FraudIndicator[];
  status: FraudStatus;
  isBlocked: boolean;
  metadata: FraudMetadata;
  reviewedBy?: string;
  reviewedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FraudMetadata {
  transactionAmount?: number;
  currency?: string;
  location?: { country: string; city?: string } | string;
  deviceId?: string;
  ipAddress?: string;
  userAgent?: string;
  [key: string]: unknown;
}

export interface FraudAlert {
  id: string;
  detectionId: string;
  severity: FraudRiskLevel;
  title: string;
  message: string;
  actionRequired: boolean;
  isRead: boolean;
  isResolved: boolean;
  actionTaken?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface FraudRule {
  id: string;
  name: string;
  description: string;
  condition: string;
  action: FraudAction;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FraudInvestigation {
  id: string;
  detectionId: string;
  investigator: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'closed';
  findings?: string;
  evidence?: unknown[];
  recommendation?: string;
  resolution?: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
}

export interface FraudCheckRequest {
  transactionId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  metadata: FraudMetadata;
}

export interface FraudCheckResponse {
  allowed: boolean;
  riskScore: number;
  riskLevel: FraudRiskLevel;
  indicators: FraudIndicator[];
  recommendation: string;
  detectionId?: string;
}

export interface FraudFilters {
  status?: FraudStatus;
  riskLevel?: FraudRiskLevel;
  startDate?: Date;
  endDate?: Date;
  dateFrom?: Date;
  dateTo?: Date;
  minRiskScore?: number;
  maxRiskScore?: number;
  userId?: string;
  subscriptionId?: string;
}

export interface RealTimeMonitoring {
  isActive: boolean;
  // Dashboard fields
  totalChecks?: number;
  blockedToday?: number;
  alertsUnread?: number;
  lastUpdated?: Date;
  // Extended fields used by fraudDetectionService
  transactionsMonitored?: number;
  activeDetections?: number;
  lastCheckTimestamp?: Date;
  systemHealth?: 'healthy' | 'degraded' | 'down';
  averageResponseTime?: number;
}

export interface DetectionStats {
  total: number;
  blocked: number;
  flagged: number;
  approved: number;
  avgRiskScore: number;
}

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
  signals?: FraudSignal[];
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

// Used by fraudDetectionService for generated reports
export interface FraudGeneratedReport {
  id: string;
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom';
  period: { start: Date; end: Date };
  summary: {
    totalDetections: number;
    blockedAmount: number;
    confirmedCases: number;
    averageRiskScore: number;
  };
  details: FraudAnalytics;
  trends: {
    detectionTrend: 'increasing' | 'decreasing' | 'stable';
    riskTrend: 'increasing' | 'decreasing' | 'stable';
  };
  recommendations: string[];
  generatedAt: Date;
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
  // Legacy service fields (returned by fraudDetectionService.getFraudAnalytics)
  totalDetections?: number;
  blockedTransactions?: number;
  confirmedFraud?: number;
  falsePositives?: number;
  averageRiskScore?: number;
  detectionsByLevel?: Record<FraudRiskLevel, number>;
  detectionsByMethod?: Record<string, number>;
  indicatorBreakdown?: Record<string, number>;
  preventedLoss?: number;
  detectionRate?: number;
  falsePositiveRate?: number;
  timeSeriesData?: {
    date: string;
    count?: number;
    detections?: number;
    blocked: number;
    confirmed?: number;
  }[];
  topRiskUsers?: { userId: string; riskScore: number; detectionCount: number }[];
  // New dashboard fields (used by fraud store and UI)
  totalChecks?: number;
  approved?: number;
  flagged?: number;
  blocked?: number;
  manualReviews?: number;
  manualReviewsClosed?: number;
  avgRisk?: number;
  velocityAlerts?: number;
  anomalyAlerts?: number;
  geoAnomalyAlerts?: number;
  chargebackPredictions?: number;
  falsePositiveEstimate?: number;
  modelConfidence?: number;
}
