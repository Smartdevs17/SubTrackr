// Monitoring & alerting type definitions

export type TransactionStatus = 'success' | 'failed' | 'pending';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertChannel = 'slack' | 'pagerduty' | 'console';

export interface TransactionEvent {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  timestamp: number;
  gasUsed?: number;
  errorMessage?: string;
}

export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  timestamp: number;
  resolved: boolean;
  ruleId: string;
  correlationId?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  /** Returns true when the rule is violated */
  evaluate: (metrics: Metric[]) => boolean;
  severity: AlertSeverity;
  message: string;
}

export interface AlertChannelConfig {
  type: AlertChannel;
  webhookUrl?: string; // Slack / PagerDuty webhook
}

// ── SLA monitoring & breach detection ────────────────────────────────────────

/** SLA target registered for a monitored subscription. */
export interface SlaTargetConfig {
  /** Minimum acceptable uptime percentage (0–100). */
  uptimeTarget: number;
  /** Rolling measurement window in seconds. */
  measurementInterval: number;
  /** Maximum credit issued per breach (0 = unlimited). */
  creditCap?: number;
}

/** A detected SLA breach for a monitored subscription. */
export interface SlaBreachRecord {
  id: string;
  subscriptionId: string;
  detectedAt: number;
  uptimeTarget: number;
  uptimePercentage: number;
  measurementInterval: number;
  observedTransactions: number;
  failedTransactions: number;
  creditAmount: number;
  resolvedAt: number | null;
  acknowledged: boolean;
}

/** Live SLA compliance status for a monitored subscription. */
export interface SlaComplianceStatus {
  subscriptionId: string;
  uptimeTarget: number;
  measurementInterval: number;
  uptimePercentage: number;
  observedTransactions: number;
  failedTransactions: number;
  compliant: boolean;
  activeBreachId: string | null;
  breachCount: number;
  creditBalance: number;
  lastUpdatedAt: number;
  lastBreachAt: number | null;
}

/** Aggregate SLA health across all monitored subscriptions. */
export interface SlaSummary {
  totalMonitored: number;
  compliant: number;
  breached: number;
  openBreaches: number;
  totalCreditsIssued: number;
}

export interface DashboardSnapshot {
  totalTransactions: number;
  successRate: number; // 0–1
  failureCount: number;
  avgGasUsed: number;
  activeAlerts: Alert[];
  recentMetrics: Metric[];
  /** Live SLA compliance status per monitored subscription. */
  slaStatuses: SlaComplianceStatus[];
  /** SLA breach records (open and resolved). */
  slaBreaches: SlaBreachRecord[];
  /** Aggregate SLA health summary. */
  slaSummary: SlaSummary;
}
