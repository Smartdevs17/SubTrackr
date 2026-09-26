/**
 * FraudAlertService
 *
 * Manages fraud alerts for the dashboard and notification pipeline.
 * Alerts are held in an in-memory ring buffer (max 200 entries) and can be
 * observed via a lightweight publish-subscribe mechanism.
 *
 * Integrates with the fraud detection service: call triggerAlertForAssessment
 * after each FraudRiskScore is produced to automatically surface dashboard
 * alerts and prepare email / push payloads.
 */

import { FraudRiskScore } from '../types/fraud';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertType =
  | 'high_risk_transaction'
  | 'block_triggered'
  | 'velocity_spike'
  | 'chargeback_alert'
  | 'geo_anomaly'
  | 'model_drift';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface FraudAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  subscriptionId?: string;
  merchantId?: string;
  merchantName?: string;
  subscriberId?: string;
  riskScore?: number;
  triggeredAt: string;
  read: boolean;
  dismissed: boolean;
}

export interface CreateAlertParams {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  subscriptionId?: string;
  merchantId?: string;
  merchantName?: string;
  subscriberId?: string;
  riskScore?: number;
}

export interface AlertFilter {
  severity?: AlertSeverity;
  type?: AlertType;
  read?: boolean;
  limit?: number;
}

export interface EmailAlertPayload {
  to: string[];
  subject: string;
  body: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ALERTS = 200;
let alertIdCounter = 0;

function nextAlertId(): string {
  alertIdCounter += 1;
  return `alert_${Date.now()}_${alertIdCounter}`;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class FraudAlertService {
  private alerts: FraudAlert[] = [];
  private subscribers: Array<(alerts: FraudAlert[]) => void> = [];
  private emailRecipients: string[] = [];
  private emailNotifier?: (payload: EmailAlertPayload) => void | Promise<void>;

  /** Create a new fraud alert and notify all subscribers. */
  createAlert(params: CreateAlertParams): FraudAlert {
    const alert: FraudAlert = {
      id: nextAlertId(),
      ...params,
      triggeredAt: new Date().toISOString(),
      read: false,
      dismissed: false,
    };

    this.alerts.unshift(alert); // newest first

    // Trim to ring-buffer size
    if (this.alerts.length > MAX_ALERTS) {
      this.alerts = this.alerts.slice(0, MAX_ALERTS);
    }

    this.notifySubscribers();
    this.deliverEmailAlert(alert);
    return alert;
  }

  setEmailRecipients(recipients: string[]): void {
    this.emailRecipients = recipients;
  }

  setEmailNotifier(notifier: (payload: EmailAlertPayload) => void | Promise<void>): void {
    this.emailNotifier = notifier;
  }

  /**
   * Return active (non-dismissed) alerts, optionally filtered.
   * Results are ordered newest-first.
   */
  getAlerts(filter?: AlertFilter): FraudAlert[] {
    let results = this.alerts.filter((a) => !a.dismissed);

    if (filter?.severity !== undefined) {
      results = results.filter((a) => a.severity === filter.severity);
    }
    if (filter?.type !== undefined) {
      results = results.filter((a) => a.type === filter.type);
    }
    if (filter?.read !== undefined) {
      results = results.filter((a) => a.read === filter.read);
    }
    if (filter?.limit !== undefined && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /** Mark a single alert as read. */
  markAsRead(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.read = true;
      this.notifySubscribers();
    }
  }

  /** Mark all visible alerts as read. */
  markAllAsRead(): void {
    this.alerts.forEach((a) => {
      if (!a.dismissed) a.read = true;
    });
    this.notifySubscribers();
  }

  /** Soft-delete an alert (hides from getAlerts but keeps in memory for audit). */
  dismissAlert(alertId: string): void {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.dismissed = true;
      this.notifySubscribers();
    }
  }

  /** Dismiss all currently visible alerts. */
  dismissAll(): void {
    this.alerts.forEach((a) => {
      a.dismissed = true;
    });
    this.notifySubscribers();
  }

  /** Count of alerts that have not yet been read and are not dismissed. */
  getUnreadCount(): number {
    return this.alerts.filter((a) => !a.dismissed && !a.read).length;
  }

  /**
   * Remove alerts older than `olderThanDays` days (default 30).
   * Returns the number of alerts removed.
   */
  clearOldAlerts(olderThanDays = 30): number {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const before = this.alerts.length;
    this.alerts = this.alerts.filter((a) => new Date(a.triggeredAt).getTime() >= cutoff);
    const removed = before - this.alerts.length;
    if (removed > 0) this.notifySubscribers();
    return removed;
  }

  /**
   * Subscribe to alert changes. Returns an unsubscribe function.
   * The callback is invoked with the current alert list after any mutation.
   */
  subscribeToAlerts(callback: (alerts: FraudAlert[]) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== callback);
    };
  }

  /**
   * Automatically create an alert for a completed risk assessment.
   * Returns the created alert, or null if the assessment was approved (no alert needed).
   */
  triggerAlertForAssessment(assessment: FraudRiskScore): FraudAlert | null {
    if (assessment.action === 'approve') return null;

    const isBlock = assessment.action === 'block';
    const severity: AlertSeverity = isBlock ? 'critical' : 'high';
    const type: AlertType = isBlock ? 'block_triggered' : 'high_risk_transaction';
    const title = isBlock
      ? `Transaction blocked — risk score ${assessment.totalScore}`
      : `High-risk transaction flagged — risk score ${assessment.totalScore}`;
    const message = assessment.reason;

    return this.createAlert({
      type,
      severity,
      title,
      message,
      subscriptionId: assessment.subscriptionId,
      merchantId: assessment.merchantId,
      merchantName: assessment.merchantName,
      subscriberId: assessment.subscriberId,
      riskScore: assessment.totalScore,
    });
  }

  /** Return total alert count including dismissed. */
  getTotalCount(): number {
    return this.alerts.length;
  }

  /** Reset service state (useful for testing). */
  reset(): void {
    this.alerts = [];
    this.subscribers = [];
    alertIdCounter = 0;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private notifySubscribers(): void {
    const current = this.getAlerts();
    this.subscribers.forEach((cb) => {
      try {
        cb(current);
      } catch {
        // Subscriber errors must not disrupt alert processing
      }
    });
  }

  private deliverEmailAlert(alert: FraudAlert): void {
    if (this.emailRecipients.length === 0) return;

    const payload: EmailAlertPayload = {
      to: this.emailRecipients,
      subject: `Fraud alert: ${alert.title}`,
      body: `${alert.message}\n\nSeverity: ${alert.severity}\nRisk score: ${alert.riskScore ?? 'n/a'}`,
    };

    if (this.emailNotifier) {
      void this.emailNotifier(payload);
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const fraudAlertService = new FraudAlertService();
