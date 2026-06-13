/**
 * Monitoring service — ingests transaction events, computes metrics,
 * detects anomalies, and exposes a dashboard snapshot.
 */

import type { TransactionEvent, Metric, AlertRule, Alert, DashboardSnapshot } from './types';

export class MonitoringService {
  private events: TransactionEvent[] = [];
  private metrics: Metric[] = [];
  private rules: AlertRule[] = [];
  private alerts: Alert[] = [];

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
    this.events.push(event);
    this._recomputeMetrics();
    this._evaluateRules();
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

  // ── Dashboard ─────────────────────────────────────────────────────────────

  getDashboard(): DashboardSnapshot {
    const total = this.events.length;
    const failed = this.events.filter((e) => e.status === 'failed').length;
    const gasValues = this.events.filter((e) => e.gasUsed !== undefined).map((e) => e.gasUsed!);
    const avgGas = gasValues.length ? gasValues.reduce((a, b) => a + b, 0) / gasValues.length : 0;

    return {
      totalTransactions: total,
      successRate: total === 0 ? 1 : (total - failed) / total,
      failureCount: failed,
      avgGasUsed: avgGas,
      activeAlerts: this.getActiveAlerts(),
      recentMetrics: this.metrics.slice(-20),
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _recomputeMetrics(): void {
    const now = Date.now();
    const total = this.events.length;
    const failed = this.events.filter((e) => e.status === 'failed').length;
    const gasValues = this.events.filter((e) => e.gasUsed !== undefined).map((e) => e.gasUsed!);
    const avgGas = gasValues.length ? gasValues.reduce((a, b) => a + b, 0) / gasValues.length : 0;

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
}
