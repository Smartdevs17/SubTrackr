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
  reviewedBy?: string;
  reviewedAt?: Date;
  notes?: string;
  metadata: FraudMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export enum FraudRiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum FraudStatus {
  PENDING = 'pending',
  INVESTIGATING = 'investigating',
  CONFIRMED = 'confirmed',
  FALSE_POSITIVE = 'false_positive',
  RESOLVED = 'resolved',
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

export interface FraudIndicator {
  type: FraudIndicatorType;
  severity: 'low' | 'medium' | 'high';
  description: string;
  value?: any;
  threshold?: number;
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

export interface FraudMetadata {
  ipAddress?: string;
  deviceId?: string;
  userAgent?: string;
  location?: {
    country: string;
    city?: string;
    latitude?: number;
    longitude?: number;
  };
  transactionAmount?: number;
  transactionCurrency?: string;
  paymentMethod?: string;
  previousTransactionCount?: number;
  accountAge?: number;
}

export interface FraudAlert {
  id: string;
  detectionId: string;
  severity: FraudRiskLevel;
  title: string;
  message: string;
  actionRequired: boolean;
  actionTaken?: string;
  isRead: boolean;
  isResolved: boolean;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface FraudAnalytics {
  totalDetections: number;
  blockedTransactions: number;
  confirmedFraud: number;
  falsePositives: number;
  averageRiskScore: number;
  detectionsByLevel: Record<FraudRiskLevel, number>;
  detectionsByMethod: Record<FraudDetectionMethod, number>;
  indicatorBreakdown: Record<FraudIndicatorType, number>;
  preventedLoss: number;
  detectionRate: number;
  falsePositiveRate: number;
  timeSeriesData: Array<{
    date: string;
    detections: number;
    blocked: number;
    confirmed: number;
  }>;
  topRiskUsers: Array<{
    userId: string;
    riskScore: number;
    detectionCount: number;
  }>;
}

export interface FraudInvestigation {
  id: string;
  detectionId: string;
  investigator: string;
  status: 'open' | 'in_progress' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  findings: string;
  evidence: FraudEvidence[];
  recommendation: string;
  actionTaken?: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
}

export interface FraudEvidence {
  id: string;
  type: 'screenshot' | 'log' | 'document' | 'transaction_history' | 'other';
  description: string;
  url?: string;
  data?: any;
  collectedAt: Date;
}

export interface FraudRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  riskScore: number;
  conditions: FraudRuleCondition[];
  action: FraudRuleAction;
  createdAt: Date;
  updatedAt: Date;
}

export interface FraudRuleCondition {
  field: string;
  operator: 'equals' | 'greater_than' | 'less_than' | 'contains' | 'in' | 'not_in';
  value: any;
}

export enum FraudRuleAction {
  FLAG = 'flag',
  BLOCK = 'block',
  REVIEW = 'review',
  NOTIFY = 'notify',
}

export interface FraudReport {
  id: string;
  reportType: 'daily' | 'weekly' | 'monthly' | 'custom';
  period: {
    start: Date;
    end: Date;
  };
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

export interface RealTimeMonitoring {
  isActive: boolean;
  transactionsMonitored: number;
  activeDetections: number;
  lastCheckTimestamp: Date;
  systemHealth: 'healthy' | 'degraded' | 'offline';
  averageResponseTime: number;
}

export interface FraudFilters {
  riskLevel?: FraudRiskLevel[];
  status?: FraudStatus[];
  dateFrom?: Date;
  dateTo?: Date;
  subscriptionId?: string;
  userId?: string;
  minRiskScore?: number;
  maxRiskScore?: number;
}

export interface FraudCheckRequest {
  transactionId: string;
  subscriptionId: string;
  userId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
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
