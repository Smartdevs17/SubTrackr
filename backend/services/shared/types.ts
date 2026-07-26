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

export interface DashboardSnapshot {
  totalTransactions: number;
  successRate: number; // 0–1
  failureCount: number;
  avgGasUsed: number;
  activeAlerts: Alert[];
  recentMetrics: Metric[];
}
