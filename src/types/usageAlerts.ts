/**
 * usageAlerts.ts — Type definitions for usage alerts and overage notifications
 *
 * Covers threshold configuration, alert generation, overage tracking and
 * the top-level alert configuration object used by usageAlertStore.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enums / union types
// ─────────────────────────────────────────────────────────────────────────────

/** The category of event that triggered an alert. */
export type UsageAlertType =
  | 'approaching_limit'
  | 'limit_exceeded'
  | 'overage'
  | 'reset'
  | 'custom';

/** How urgent the alert is. Maps to colour-coding in the UI. */
export type UsageAlertSeverity = 'info' | 'warning' | 'critical';

// ─────────────────────────────────────────────────────────────────────────────
// Core domain objects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A user-configured threshold for a specific metric on a specific subscription.
 * The three percentage values define when warning / critical / overage alerts
 * are fired.
 */
export interface UsageThreshold {
  /** Unique identifier (uuid). */
  id: string;
  /** The subscription this threshold applies to. */
  subscriptionId: string;
  /** The metric being monitored (e.g. 'ApiCalls', 'Storage', 'Seats'). */
  metricName: string;
  /**
   * Percentage of the quota limit at which a *warning* alert is generated.
   * @default 80
   */
  warningPercent: number;
  /**
   * Percentage of the quota limit at which a *critical* alert is generated.
   * @default 95
   */
  criticalPercent: number;
  /**
   * Percentage of the quota limit at which an *overage* alert is generated.
   * Typically 100 — i.e. the limit has been hit.
   * @default 100
   */
  overagePercent: number;
  /** Whether this threshold is currently active. */
  enabled: boolean;
}

/**
 * A single usage alert generated when consumption crosses a threshold.
 */
export interface UsageAlert {
  /** Unique identifier (uuid). */
  id: string;
  /** The subscription this alert relates to. */
  subscriptionId: string;
  /** The metric that triggered the alert. */
  metricName: string;
  /** What kind of limit was crossed. */
  type: UsageAlertType;
  /** How severe the alert is. */
  severity: UsageAlertSeverity;
  /** Short human-readable title for the alert card. */
  title: string;
  /** Longer description with contextual detail. */
  message: string;
  /** Current raw usage value at the time the alert was generated. */
  currentValue: number;
  /** The quota limit against which currentValue was compared. */
  limitValue: number;
  /** currentValue / limitValue × 100, clamped to [0, ∞). */
  usagePercent: number;
  /** ISO-8601 timestamp when the alert was created. */
  timestamp: string;
  /** Whether the user has seen / acknowledged this alert. */
  isRead: boolean;
  /** Whether the user has explicitly dismissed this alert. */
  isDismissed: boolean;
}

/**
 * A dedicated overage notification created when usage exceeds 100 % of the
 * quota limit and carries a monetary cost.
 */
export interface OverageNotification {
  /** Unique identifier (uuid). */
  id: string;
  /** The subscription this overage relates to. */
  subscriptionId: string;
  /** The metric that went into overage. */
  metricName: string;
  /** How many units were consumed beyond the included quota. */
  overageAmount: number;
  /** Estimated monetary cost of the overage in the plan's billing currency. */
  overageCost: number;
  /** ISO-8601 timestamp when the overage was detected. */
  timestamp: string;
  /** Whether the user has acknowledged and reviewed this notification. */
  isAcknowledged: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-level configuration object stored alongside the alert state.
 * Controls which alert categories are active and how often alerts can
 * repeat for the same metric.
 */
export interface UsageAlertConfig {
  /** Per-metric threshold definitions. */
  thresholds: UsageThreshold[];
  /** Fire an alert when usage approaches (but has not yet hit) the limit. */
  notifyOnApproaching: boolean;
  /** Fire an alert when usage hits or exceeds the configured limit. */
  notifyOnExceeded: boolean;
  /** Fire an overage notification once a hard limit is breached. */
  notifyOnOverage: boolean;
  /**
   * Minimum number of minutes that must elapse before the same threshold
   * can fire again for the same metric.
   * @default 60
   */
  cooldownMinutes: number;
}
