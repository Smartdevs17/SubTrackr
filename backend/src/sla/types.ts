/**
 * backend/src/sla/types.ts
 *
 * Public types for SLA monitoring, per-tier breach alerting and credit
 * issuance. See ./README.md for the model.
 */

import type { Alert, AlertSeverity } from '../../services/shared/types';
import type { IssueCreditInput } from '../../services/billing/creditTypes';

/** Metrics an SLA is measured on. */
export type SlaMetric = 'uptime' | 'latency' | 'error_rate';

/** One step of an uptime credit schedule: below this uptime, credit this much. */
export interface SlaCreditStep {
  /** Measured uptime strictly below this percentage triggers the step. */
  belowUptimePercent: number;
  /** Credit as a percentage of the period fee. */
  creditPercent: number;
}

/** Contractual targets and remedies for one service tier. */
export interface SlaTierPolicy {
  tier: string;
  /** Monthly uptime commitment, e.g. 99.9. */
  uptimeTargetPercent: number;
  /** p95 request latency commitment in milliseconds. */
  p95LatencyTargetMs: number;
  /** Maximum share of failed requests, in percent. */
  errorRateTargetPercent: number;
  /** Uptime credit steps; the most severe matching step applies. Empty = no uptime credits. */
  creditSchedule: SlaCreditStep[];
  /** Credit added when the p95 latency target is missed. */
  latencyBreachCreditPercent: number;
  /** Credit added when the error-rate target is missed. */
  errorRateBreachCreditPercent: number;
  /** Cap on the total credit for one period, as a percentage of the fee. */
  maxCreditPercent: number;
  /** Alert severity used when this tier breaches. */
  breachAlertSeverity: AlertSeverity;
  /** Warn once this share of the period's downtime budget is consumed. */
  atRiskBudgetPercent: number;
}

/** A subscription enrolled in SLA monitoring. */
export interface SlaSubscription {
  subscriptionId: string;
  /** Credit ledger account that receives SLA credits. */
  accountId: string;
  tier: string;
  /** Fee for one measurement period (calendar month), in account currency. */
  periodFee: number;
  /** Enrolment time (ms). Earlier time in its first period is not measured. */
  registeredAt: number;
}

export interface SlaIncident {
  id: string;
  start: number;
  /** Undefined while the incident is still open. */
  end?: number;
  /** Affected subscriptions; undefined means every monitored subscription. */
  subscriptionIds?: string[];
  /** Scheduled maintenance is excluded from both downtime and measured time. */
  maintenance: boolean;
  description?: string;
}

/** Evaluation of one subscription over a window of its measurement period. */
export interface SlaPeriodReport {
  subscriptionId: string;
  tier: string;
  periodStart: number;
  periodEnd: number;
  /** End of the evaluated window: `periodEnd` for closed periods, now for live status. */
  evaluatedUntil: number;
  /** Measured time in the window, excluding maintenance and pre-enrolment time. */
  measuredMs: number;
  /** Unplanned downtime in the window. */
  downtimeMs: number;
  uptimePercent: number;
  /** Allowed downtime over the full period at the tier's uptime target. */
  downtimeBudgetMs: number;
  /** Share of the downtime budget consumed, in percent (may exceed 100). */
  budgetConsumedPercent: number;
  requestCount: number;
  errorCount: number;
  /** Null until enough requests were observed to be meaningful. */
  errorRatePercent: number | null;
  /** Null until enough requests were observed to be meaningful. */
  p95LatencyMs: number | null;
  breaches: SlaMetric[];
  compliant: boolean;
}

export type SlaCreditStatus = 'issued' | 'failed' | 'not_owed';

export interface SlaCreditRecord {
  subscriptionId: string;
  accountId: string;
  periodStart: number;
  periodEnd: number;
  creditPercent: number;
  amount: number;
  status: SlaCreditStatus;
  attempts: number;
  issuedAt?: number;
  error?: string;
  report: SlaPeriodReport;
}

// ── Collaborators (injected; satisfied by existing backend services) ─────────

/** Satisfied by `CreditService` in backend/services/billing/creditService.ts. */
export interface SlaCreditIssuer {
  issueCredit(input: IssueCreditInput): unknown;
}

/** Satisfied by `AlertingService` in backend/services/notification/alerting.ts. */
export interface SlaAlertSink {
  dispatch(alert: Alert): Promise<void> | void;
}

export interface SlaMetrics {
  increment(name: string, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
}

export type SlaLogger = Pick<Console, 'info' | 'warn' | 'error'>;
