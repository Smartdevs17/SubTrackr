/**
 * Monitoring service — ingests transaction events, computes metrics,
 * detects anomalies, monitors subscription SLA compliance with breach
 * detection, and exposes a dashboard snapshot.
 */

import type {
  TransactionEvent,
  Metric,
  AlertRule,
  Alert,
  AlertSeverity,
  DashboardSnapshot,
  SlaTargetConfig,
  SlaBreachRecord,
  SlaComplianceStatus,
  SlaSummary,
} from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calculate the credit owed for an SLA breach, mirroring the platform-wide
 * credit policy (see `calculateCreditAmount` in `src/services/slaService.ts`).
 *
 * The credit scales with how far uptime fell below target, weighted by the
 * length of the measurement interval, and is capped by `creditCap` when set.
 */
export function calculateSlaCreditAmount(
  target: Pick<SlaTargetConfig, 'uptimeTarget' | 'measurementInterval' | 'creditCap'>,
  uptimePercentage: number
): number {
  if (uptimePercentage >= target.uptimeTarget) return 0;

  const deficit = target.uptimeTarget - uptimePercentage;
  const normalizedDeficit = deficit / Math.max(target.uptimeTarget, 1);
  const rawCredit = normalizedDeficit * target.measurementInterval * 100;
  const credit = Math.max(1, Math.round(rawCredit));
  const cap = target.creditCap ?? 0;
  return cap > 0 ? Math.min(credit, cap) : credit;
}

export class MonitoringService {
  private metrics: Metric[] = [];
  private rules: AlertRule[] = [];
  private alerts: Alert[] = [];

  // Incremental counters keep ingestion O(1) per event instead of rescanning
  // the whole stream on every recordTransaction.
  private totalTransactions = 0;
  private failedTransactions = 0;
  private gasSum = 0;
  private gasCount = 0;

  // ── SLA monitoring state ───────────────────────────────────────────────────

  private slaTargets = new Map<string, SlaTargetConfig>();
  private slaBreaches: SlaBreachRecord[] = [];
  private slaEventsBySubscription = new Map<string, TransactionEvent[]>();
  /** Hard cap on retained SLA events per subscription (bounded memory). */
  private readonly maxSlaEventsPerSubscription = 5000;

  // ── Built-in anomaly detection rules ──────────────────────────────────────

  /** Default rules: high failure rate and gas spike */
  static defaultRules(): AlertRule[] {
    return [
      {
        id: 'high-failure-rate',
        name: 'High Transaction Failure Rate',
        severity: 'critical',
        message: 'Transaction failure rate exceeded 30 %',
        evaluate(metrics) {
          const rate = metrics.find((m) => m.name === 'failure_rate');
          return rate !== undefined && rate.value > 0.3;
        },
      },
      {
        id: 'gas-spike',
        name: 'Gas Usage Spike',
        severity: 'warning',
        message: 'Average gas usage exceeded 500 000 units',
        evaluate(metrics) {
          const gas = metrics.find((m) => m.name === 'avg_gas_used');
          return gas !== undefined && gas.value > 500_000;
        },
      },
    ];
  }

  constructor(rules: AlertRule[] = MonitoringService.defaultRules()) {
    this.rules = rules;
  }

  // ── Transaction ingestion ─────────────────────────────────────────────────

  recordTransaction(event: TransactionEvent): void {
    this.totalTransactions += 1;
    if (event.status === 'failed') this.failedTransactions += 1;
    if (event.gasUsed !== undefined) {
      this.gasSum += event.gasUsed;
      this.gasCount += 1;
    }
    this._recordSlaEvent(event);
    this._recomputeMetrics();
    this._evaluateRules();
    // Re-evaluate SLA compliance for the affected subscription after every event.
    this._evaluateSla(event.subscriptionId);
  }

  // ── Custom alert rules ────────────────────────────────────────────────────

  addRule(rule: AlertRule): void {
    this.rules = [...this.rules.filter((r) => r.id !== rule.id), rule];
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  // ── Alert management ──────────────────────────────────────────────────────

  resolveAlert(alertId: string): void {
    this.alerts = this.alerts.map((a) => (a.id === alertId ? { ...a, resolved: true } : a));
  }

  getActiveAlerts(): Alert[] {
    return this.alerts.filter((a) => !a.resolved);
  }

  // ── SLA target configuration ──────────────────────────────────────────────

  /**
   * Register (or update) an SLA target for a subscription. The subscription is
   * evaluated immediately, so breaches are detected as soon as a target exists.
   */
  setSlaTarget(subscriptionId: string, target: SlaTargetConfig): void {
    const uptimeTarget = Number.isFinite(target.uptimeTarget)
      ? clamp(Number(target.uptimeTarget), 0, 100)
      : 99;
    const measurementInterval = Number.isFinite(target.measurementInterval)
      ? Math.max(1, Math.floor(Number(target.measurementInterval)))
      : 7 * 24 * 60 * 60;
    const creditCap =
      Number.isFinite(target.creditCap) && (target.creditCap ?? 0) > 0
        ? Number(target.creditCap)
        : 0;

    this.slaTargets.set(subscriptionId, { uptimeTarget, measurementInterval, creditCap });
    this._evaluateSla(subscriptionId);
  }

  /** Stop monitoring a subscription for SLA compliance. */
  removeSlaTarget(subscriptionId: string): void {
    this.slaTargets.delete(subscriptionId);
    this.slaEventsBySubscription.delete(subscriptionId);
    // Close any open SLA alert for this subscription.
    this.alerts = this.alerts.map((a) =>
      a.ruleId === `sla-breach:${subscriptionId}` ? { ...a, resolved: true } : a
    );
  }

  getSlaTarget(subscriptionId: string): SlaTargetConfig | undefined {
    return this.slaTargets.get(subscriptionId);
  }

  // ── SLA status & breaches ─────────────────────────────────────────────────

  /** Live compliance status for a monitored subscription (or null if unmonitored). */
  getSlaStatus(subscriptionId: string): SlaComplianceStatus | null {
    const target = this.slaTargets.get(subscriptionId);
    if (!target) return null;
    return this._computeSlaStatus(subscriptionId, target);
  }

  /** Live compliance status for every monitored subscription. */
  getSlaStatuses(): SlaComplianceStatus[] {
    return Array.from(this.slaTargets.keys()).map((id) =>
      this._computeSlaStatus(id, this.slaTargets.get(id)!)
    );
  }

  /** Aggregate SLA health across all monitored subscriptions. */
  getSlaSummary(): SlaSummary {
    const statuses = this.getSlaStatuses();
    const openBreaches = this.slaBreaches.filter((b) => !b.resolvedAt);
    return {
      totalMonitored: this.slaTargets.size,
      compliant: statuses.filter((s) => s.compliant).length,
      breached: statuses.filter((s) => !s.compliant).length,
      openBreaches: openBreaches.length,
      totalCreditsIssued: round2(this.slaBreaches.reduce((sum, b) => sum + b.creditAmount, 0)),
    };
  }

  /**
   * SLA breach records, newest first. Pass a subscription id to filter.
   */
  getSlaBreaches(subscriptionId?: string): SlaBreachRecord[] {
    const breaches = subscriptionId
      ? this.slaBreaches.filter((b) => b.subscriptionId === subscriptionId)
      : [...this.slaBreaches];
    return breaches.sort((a, b) => b.detectedAt - a.detectedAt);
  }

  /** Manually resolve an SLA breach (e.g. operator override). */
  resolveSlaBreach(breachId: string): void {
    const breach = this.slaBreaches.find((b) => b.id === breachId);
    if (!breach || breach.resolvedAt) return;
    breach.resolvedAt = Date.now();
    this.alerts = this.alerts.map((a) =>
      a.correlationId === breachId ? { ...a, resolved: true } : a
    );
  }

  /** Mark an SLA breach as acknowledged by an operator. */
  acknowledgeSlaBreach(breachId: string): void {
    const breach = this.slaBreaches.find((b) => b.id === breachId);
    if (breach) breach.acknowledged = true;
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  getDashboard(): DashboardSnapshot {
    const total = this.totalTransactions;
    const failed = this.failedTransactions;
    const avgGas = this.gasCount > 0 ? this.gasSum / this.gasCount : 0;

    return {
      totalTransactions: total,
      successRate: total === 0 ? 1 : (total - failed) / total,
      failureCount: failed,
      avgGasUsed: avgGas,
      activeAlerts: this.getActiveAlerts(),
      recentMetrics: this.metrics.slice(-20),
      slaStatuses: this.getSlaStatuses(),
      slaBreaches: this.getSlaBreaches(),
      slaSummary: this.getSlaSummary(),
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _recomputeMetrics(): void {
    const now = Date.now();
    const total = this.totalTransactions;
    const failed = this.failedTransactions;
    const avgGas = this.gasCount > 0 ? this.gasSum / this.gasCount : 0;

    this.metrics.push(
      { name: 'failure_rate', value: total === 0 ? 0 : failed / total, timestamp: now },
      { name: 'avg_gas_used', value: avgGas, timestamp: now },
      { name: 'total_transactions', value: total, timestamp: now }
    );
  }

  private _evaluateRules(): void {
    for (const rule of this.rules) {
      const triggered = rule.evaluate(this.metrics);
      if (!triggered) continue;
      // Avoid duplicate open alerts for the same rule
      const alreadyOpen = this.alerts.some((a) => a.ruleId === rule.id && !a.resolved);
      if (alreadyOpen) continue;
      this.alerts.push({
        id: `${rule.id}-${Date.now()}`,
        severity: rule.severity,
        title: rule.name,
        message: rule.message,
        timestamp: Date.now(),
        resolved: false,
        ruleId: rule.id,
      });
    }
  }

  // ── SLA internals ─────────────────────────────────────────────────────────

  /** Keep a bounded, per-subscription view of the transaction stream for SLA math. */
  private _recordSlaEvent(event: TransactionEvent): void {
    const list = this.slaEventsBySubscription.get(event.subscriptionId) ?? [];
    list.push(event);
    if (list.length > this.maxSlaEventsPerSubscription) {
      list.splice(0, list.length - this.maxSlaEventsPerSubscription);
    }
    this.slaEventsBySubscription.set(event.subscriptionId, list);
  }

  /**
   * Compute the current SLA status for a subscription from transactions in its
   * rolling measurement window. Uptime is the share of observed transactions
   * that succeeded; a subscription with no traffic in the window is compliant.
   */
  private _computeSlaStatus(
    subscriptionId: string,
    target: SlaTargetConfig,
    now = Date.now()
  ): SlaComplianceStatus {
    const windowStart = now - target.measurementInterval * 1000;
    const events = (this.slaEventsBySubscription.get(subscriptionId) ?? []).filter(
      (e) => e.timestamp >= windowStart
    );

    let observed = 0;
    let failed = 0;
    for (const event of events) {
      if (event.status === 'pending') continue;
      observed += 1;
      if (event.status === 'failed') failed += 1;
    }

    const uptimePercentage = observed === 0 ? 100 : round2(((observed - failed) / observed) * 100);
    const compliant = uptimePercentage >= target.uptimeTarget;

    const subBreaches = this.slaBreaches.filter((b) => b.subscriptionId === subscriptionId);
    const openBreach = [...subBreaches].reverse().find((b) => !b.resolvedAt) ?? null;

    return {
      subscriptionId,
      uptimeTarget: target.uptimeTarget,
      measurementInterval: target.measurementInterval,
      uptimePercentage,
      observedTransactions: observed,
      failedTransactions: failed,
      compliant,
      activeBreachId: openBreach?.id ?? null,
      breachCount: subBreaches.length,
      creditBalance: round2(subBreaches.reduce((sum, b) => sum + b.creditAmount, 0)),
      lastUpdatedAt: now,
      lastBreachAt: subBreaches.length
        ? Math.max(...subBreaches.map((b) => b.detectedAt))
        : null,
    };
  }

  /**
   * Evaluate SLA compliance for a subscription and update breach state:
   *  - non-compliant with no open breach → open a breach (and alert)
   *  - compliant with an open breach → resolve it (and its alert)
   */
  private _evaluateSla(subscriptionId: string, now = Date.now()): void {
    const target = this.slaTargets.get(subscriptionId);
    if (!target) return;

    const status = this._computeSlaStatus(subscriptionId, target, now);
    const openBreach =
      [...this.slaBreaches]
        .reverse()
        .find((b) => b.subscriptionId === subscriptionId && !b.resolvedAt) ?? null;

    if (!status.compliant && !openBreach) {
      const creditAmount = calculateSlaCreditAmount(target, status.uptimePercentage);
      const breach: SlaBreachRecord = {
        id: `sla-breach-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        subscriptionId,
        detectedAt: now,
        uptimeTarget: target.uptimeTarget,
        uptimePercentage: status.uptimePercentage,
        measurementInterval: target.measurementInterval,
        observedTransactions: status.observedTransactions,
        failedTransactions: status.failedTransactions,
        creditAmount,
        resolvedAt: null,
        acknowledged: false,
      };
      this.slaBreaches.push(breach);
      this._emitSlaBreachAlert(breach);
    } else if (status.compliant && openBreach) {
      openBreach.resolvedAt = now;
      this.alerts = this.alerts.map((a) =>
        a.ruleId === `sla-breach:${subscriptionId}` ? { ...a, resolved: true } : a
      );
    }
  }

  /** Raise an alert so SLA breaches also surface in the platform alert stream. */
  private _emitSlaBreachAlert(breach: SlaBreachRecord): void {
    const deviation = breach.uptimeTarget - breach.uptimePercentage;
    const severity: AlertSeverity = deviation >= 5 ? 'critical' : deviation >= 1 ? 'warning' : 'info';
    this.alerts.push({
      id: `sla-alert-${breach.id}`,
      severity,
      title: 'SLA breach detected',
      message:
        `Subscription ${breach.subscriptionId} dropped to ${breach.uptimePercentage.toFixed(2)}% ` +
        `uptime (target ${breach.uptimeTarget}%) over ${breach.measurementInterval}s. ` +
        `Credit issued: ${breach.creditAmount}.`,
      timestamp: breach.detectedAt,
      resolved: false,
      ruleId: `sla-breach:${breach.subscriptionId}`,
      correlationId: breach.id,
    });
  }
}

export const monitoringService = new MonitoringService();
