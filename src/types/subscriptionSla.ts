/**
 * Subscription-level SLA monitoring types.
 *
 * Extends the merchant-level SLA system to track per-subscription
 * SLA compliance, breach detection, and automatic credit issuance.
 */

import type { SlaAvailabilityState } from './sla';

// ── Subscription tier SLA definitions ─────────────────────────────────────────

export type SubscriptionSlaTier = 'free' | 'basic' | 'standard' | 'premium' | 'enterprise';

export interface SubscriptionSlaTarget {
  /** Minimum uptime percentage (e.g. 99.9) */
  uptimeTarget: number;
  /** Maximum allowed response time in milliseconds */
  maxResponseTimeMs: number;
  /** Maximum allowed error rate percentage (e.g. 1.0 = 1%) */
  maxErrorRate: number;
  /** Maximum allowed latency in milliseconds */
  maxLatencyMs: number;
  /** Credit percentage issued per breach (0-100) */
  creditPercentage: number;
  /** Maximum credit cap per billing period */
  maxCreditCap: number;
}

/**
 * Default SLA targets per subscription tier.
 * Higher tiers receive stricter guarantees.
 */
export const DEFAULT_SLA_TARGETS: Record<SubscriptionSlaTier, SubscriptionSlaTarget> = {
  free: {
    uptimeTarget: 95,
    maxResponseTimeMs: 5000,
    maxErrorRate: 10,
    maxLatencyMs: 3000,
    creditPercentage: 0,
    maxCreditCap: 0,
  },
  basic: {
    uptimeTarget: 99,
    maxResponseTimeMs: 2000,
    maxErrorRate: 5,
    maxLatencyMs: 1500,
    creditPercentage: 5,
    maxCreditCap: 50,
  },
  standard: {
    uptimeTarget: 99.5,
    maxResponseTimeMs: 1000,
    maxErrorRate: 2,
    maxLatencyMs: 800,
    creditPercentage: 10,
    maxCreditCap: 100,
  },
  premium: {
    uptimeTarget: 99.9,
    maxResponseTimeMs: 500,
    maxErrorRate: 1,
    maxLatencyMs: 300,
    creditPercentage: 15,
    maxCreditCap: 250,
  },
  enterprise: {
    uptimeTarget: 99.99,
    maxResponseTimeMs: 200,
    maxErrorRate: 0.1,
    maxLatencyMs: 100,
    creditPercentage: 25,
    maxCreditCap: 500,
  },
};

// ── Subscription SLA metric types ─────────────────────────────────────────────

export type SlaMetricKind = 'uptime' | 'response_time' | 'error_rate' | 'latency' | 'throughput';

export type SlaBreachSeverity = 'warning' | 'minor' | 'major' | 'critical';

export interface SlaMetricSample {
  /** Metric kind being measured */
  kind: SlaMetricKind;
  /** Measured value */
  value: number;
  /** ISO timestamp of measurement */
  timestamp: number;
  /** Optional subscription context */
  subscriptionId?: string;
}

// ── Subscription SLA tracking ─────────────────────────────────────────────────

export interface SubscriptionSlaConfig {
  subscriptionId: string;
  tier: SubscriptionSlaTier;
  targets: SubscriptionSlaTarget;
  /** Monitoring check interval in seconds */
  checkIntervalSeconds: number;
  /** Whether auto-credit is enabled on breach */
  autoCreditEnabled: boolean;
  /** Contacts to alert on breach */
  alertContacts: string[];
  /** Escalation rules */
  escalationRules: SlaEscalationRule[];
  createdAt: number;
  updatedAt: number;
}

export interface SlaEscalationRule {
  severity: SlaBreachSeverity;
  /** Minutes before escalation triggers */
  afterMinutes: number;
  action: 'alert' | 'notify_admin' | 'escalate' | 'auto_credit';
  recipients: string[];
}

// ── Subscription SLA breach ───────────────────────────────────────────────────

export interface SubscriptionSlaBreach {
  id: string;
  subscriptionId: string;
  tier: SubscriptionSlaTier;
  severity: SlaBreachSeverity;
  metricKind: SlaMetricKind;
  targetValue: number;
  actualValue: number;
  deviationPercent: number;
  /** Credit amount issued (0 if not applicable) */
  creditIssued: number;
  detectedAt: number;
  resolvedAt: number | null;
  acknowledged: boolean;
  notes: string;
}

// ── SLA alert ─────────────────────────────────────────────────────────────────

export interface SubscriptionSlaAlert {
  id: string;
  breachId: string;
  subscriptionId: string;
  severity: SlaBreachSeverity;
  title: string;
  message: string;
  actionRequired: boolean;
  isRead: boolean;
  isResolved: boolean;
  sentAt: number;
  acknowledgedAt: number | null;
  resolvedAt: number | null;
}

// ── SLA status snapshot ───────────────────────────────────────────────────────

export interface SubscriptionSlaStatus {
  subscriptionId: string;
  tier: SubscriptionSlaTier;
  uptimePercentage: number;
  avgResponseTimeMs: number;
  errorRate: number;
  avgLatencyMs: number;
  compliant: boolean;
  activeBreachCount: number;
  totalBreachCount: number;
  creditBalance: number;
  lastCheckedAt: number;
}

// ── SLA analytics & reporting ─────────────────────────────────────────────────

export interface SubscriptionSlaAnalytics {
  totalSubscriptions: number;
  compliantCount: number;
  nonCompliantCount: number;
  averageUptime: number;
  totalBreaches: number;
  totalCreditsIssued: number;
  mttr: number;
  breachesBySeverity: Record<SlaBreachSeverity, number>;
  breachesByMetric: Record<SlaMetricKind, number>;
  breachesByTier: Record<SubscriptionSlaTier, number>;
  complianceTrend: Array<{ date: string; compliance: number; breaches: number }>;
  topBreachedSubscriptions: Array<{
    subscriptionId: string;
    tier: SubscriptionSlaTier;
    breachCount: number;
    compliance: number;
  }>;
}

export interface SubscriptionSlaReport {
  id: string;
  reportType: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  periodStart: number;
  periodEnd: number;
  analytics: SubscriptionSlaAnalytics;
  breaches: SubscriptionSlaBreach[];
  recommendations: string[];
  generatedAt: number;
}

// ── SLA dashboard ─────────────────────────────────────────────────────────────

export interface SubscriptionSlaDashboard {
  overview: {
    totalSubscriptions: number;
    compliantPercentage: number;
    activeBreaches: number;
    creditsIssued: number;
  };
  statusBreakdown: {
    compliant: number;
    atRisk: number;
    breached: number;
    critical: number;
  };
  recentBreaches: SubscriptionSlaBreach[];
  recentAlerts: SubscriptionSlaAlert[];
  complianceTrend: Array<{ date: string; compliance: number; breaches: number }>;
}

// ── Monitor evaluation input/output ───────────────────────────────────────────

export interface SlaEvaluationInput {
  config: SubscriptionSlaConfig;
  metrics: SlaMetricSample[];
  existingBreaches: SubscriptionSlaBreach[];
  now?: number;
}

export interface SlaEvaluationResult {
  status: SubscriptionSlaStatus;
  breaches: SubscriptionSlaBreach[];
  newBreaches: SubscriptionSlaBreach[];
  resolvedBreachIds: string[];
  alerts: SubscriptionSlaAlert[];
}
