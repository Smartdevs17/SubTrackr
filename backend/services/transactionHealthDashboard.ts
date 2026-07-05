/**
 * Transaction Health Dashboard — Issue #427
 *
 * Aggregates real-time metrics across all payment timeout records
 * and exposes a unified health view for operators and the frontend.
 */

import type {
  PaymentTimeoutRecord,
  TimeoutHealthSummary,
} from './paymentTimeoutService';
import { PaymentTimeoutService } from './paymentTimeoutService';
import type { Metric, DashboardSnapshot, Alert } from './types';

// ── Dashboard-specific types ──────────────────────────────────────────────────

export interface StuckTransactionEntry {
  chargeId: string;
  subscriptionId: string;
  chainId: number;
  status: PaymentTimeoutRecord['status'];
  stuckForMs: number;
  recoveryAttempts: number;
  lastGasPrice: string; // stringified bigint for JSON safety
}

export interface TxHealthDashboardSnapshot {
  generatedAt: number;
  overall: TimeoutHealthSummary;
  stuckTransactions: StuckTransactionEntry[];
  chainBreakdown: ChainHealthEntry[];
  recentAlerts: Alert[];
  metrics: Metric[];
}

export interface ChainHealthEntry {
  chainId: number;
  total: number;
  stuck: number;
  recoveryRate: number;
}

// ── Dashboard service ─────────────────────────────────────────────────────────

export class TransactionHealthDashboard {
  private recentAlerts: Alert[] = [];
  private readonly maxAlerts = 50;

  constructor(private readonly timeoutService: PaymentTimeoutService) {}

  /**
   * Capture an alert to display on the dashboard.
   * Called by the `PaymentTimeoutService` alerting integration.
   */
  recordAlert(alert: Alert): void {
    this.recentAlerts.unshift(alert);
    if (this.recentAlerts.length > this.maxAlerts) {
      this.recentAlerts.pop();
    }
  }

  /** Build a full dashboard snapshot for an operator view. */
  getSnapshot(subscriptionId?: string): TxHealthDashboardSnapshot {
    const now = Date.now();
    const overall = this.timeoutService.getHealthSummary(subscriptionId);

    const stuckRaw = this.timeoutService.getStuckTransactions(subscriptionId);
    const stuckTransactions: StuckTransactionEntry[] = stuckRaw.map((r) => ({
      chargeId: r.chargeId,
      subscriptionId: r.subscriptionId,
      chainId: r.chainId,
      status: r.status,
      stuckForMs: now - (r.timedOutAt ?? r.submittedAt),
      recoveryAttempts: r.recoveryAttempts,
      lastGasPrice: r.lastGasPrice.toString(),
    }));

    const chainBreakdown = this.buildChainBreakdown(subscriptionId);
    const metrics = this.buildMetrics(overall, now);

    return {
      generatedAt: now,
      overall,
      stuckTransactions,
      chainBreakdown,
      recentAlerts: this.recentAlerts.slice(0, 10),
      metrics,
    };
  }

  /** Convert the snapshot into a `DashboardSnapshot` compatible with the
   *  existing monitoring infrastructure. */
  toLegacySnapshot(subscriptionId?: string): DashboardSnapshot {
    const snap = this.getSnapshot(subscriptionId);
    return {
      totalTransactions: snap.overall.total,
      successRate: snap.overall.recoveryRate,
      failureCount: snap.overall.timedOut + snap.overall.abandoned,
      avgGasUsed: 0,
      activeAlerts: snap.recentAlerts.filter((a) => !a.resolved),
      recentMetrics: snap.metrics,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private buildChainBreakdown(subscriptionId?: string): ChainHealthEntry[] {
    const allRecords = subscriptionId
      ? this.timeoutService.getSubscriptionTimeouts(subscriptionId)
      : this.getAllRecords();

    const byChain = new Map<number, { total: number; stuck: number; resolved: number; terminal: number }>();

    for (const r of allRecords) {
      const entry = byChain.get(r.chainId) ?? {
        total: 0,
        stuck: 0,
        resolved: 0,
        terminal: 0,
      };
      entry.total += 1;
      if (r.status === 'timed_out' || r.status === 'recovering') entry.stuck += 1;
      if (r.status === 'resolved') entry.resolved += 1;
      if (r.status === 'resolved' || r.status === 'abandoned') entry.terminal += 1;
      byChain.set(r.chainId, entry);
    }

    return Array.from(byChain.entries()).map(([chainId, stats]) => ({
      chainId,
      total: stats.total,
      stuck: stats.stuck,
      recoveryRate: stats.terminal > 0 ? stats.resolved / stats.terminal : 0,
    }));
  }

  private buildMetrics(summary: TimeoutHealthSummary, now: number): Metric[] {
    return [
      { name: 'payment_timeout.total',      value: summary.total,      timestamp: now },
      { name: 'payment_timeout.pending',    value: summary.pending,    timestamp: now },
      { name: 'payment_timeout.timed_out',  value: summary.timedOut,   timestamp: now },
      { name: 'payment_timeout.recovering', value: summary.recovering, timestamp: now },
      { name: 'payment_timeout.resolved',   value: summary.resolved,   timestamp: now },
      { name: 'payment_timeout.abandoned',  value: summary.abandoned,  timestamp: now },
      { name: 'payment_timeout.recovery_rate', value: summary.recoveryRate, timestamp: now },
    ];
  }

  /** Access all records via the service's public API. */
  private getAllRecords(): PaymentTimeoutRecord[] {
    return this.timeoutService.getStuckTransactions();
  }
}

export const transactionHealthDashboard = new TransactionHealthDashboard(
  new PaymentTimeoutService()
);
