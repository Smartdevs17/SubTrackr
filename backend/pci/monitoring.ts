/**
 * PCI DSS — Monitoring (Requirement 10: Track and monitor access)
 *
 * Continuous monitoring of payment system access, transaction anomalies,
 * and security events within the cardholder data environment.
 */

export interface PaymentMonitoringControl {
  id: string;
  name: string;
  description: string;
  metric: string;
  threshold: number;
  comparison: 'gt' | 'lt' | 'eq';
  severity: 'warning' | 'critical';
  enabled: boolean;
}

export interface PaymentMonitoringAlert {
  id: string;
  controlId: string;
  controlName: string;
  triggeredAt: number;
  value: number;
  threshold: number;
  severity: 'warning' | 'critical';
  acknowledged: boolean;
  acknowledgedBy?: string;
}

export const PCI_MONITORING_CONTROLS: PaymentMonitoringControl[] = [
  {
    id: 'failed_payment_attempts',
    name: 'Failed Payment Attempts',
    description: 'Alert when failed payment attempts exceed 5 in 10 minutes',
    metric: 'payment.failed.count',
    threshold: 5,
    comparison: 'gt',
    severity: 'critical',
    enabled: true,
  },
  {
    id: 'refund_volume_anomaly',
    name: 'Refund Volume Anomaly',
    description: 'Alert when refund volume exceeds 20% of daily transactions',
    metric: 'payment.refund.ratio_pct',
    threshold: 20,
    comparison: 'gt',
    severity: 'warning',
    enabled: true,
  },
  {
    id: 'unauthorized_pan_access',
    name: 'Unauthorized PAN Access',
    description: 'Alert on any attempt to access full PAN data',
    metric: 'payment.pan.unauthorized_access',
    threshold: 0,
    comparison: 'gt',
    severity: 'critical',
    enabled: true,
  },
  {
    id: 'off_hours_payment_access',
    name: 'Off-Hours Payment Access',
    description: 'Alert when payment system is accessed outside business hours',
    metric: 'payment.access.off_hours',
    threshold: 0,
    comparison: 'gt',
    severity: 'warning',
    enabled: true,
  },
  {
    id: 'token_vault_growth',
    name: 'Token Vault Growth Rate',
    description: 'Alert when token vault grows by more than 1000 tokens per hour',
    metric: 'payment.vault.growth_per_hour',
    threshold: 1000,
    comparison: 'gt',
    severity: 'warning',
    enabled: true,
  },
  {
    id: 'detokenization_frequency',
    name: 'Detokenization Frequency',
    description: 'Alert when detokenization exceeds 10 calls per hour',
    metric: 'payment.detokenization.count_per_hour',
    threshold: 10,
    comparison: 'gt',
    severity: 'critical',
    enabled: true,
  },
];

export class PaymentMonitoringService {
  private alerts: PaymentMonitoringAlert[] = [];
  private lastValues: Map<string, number> = new Map();

  getControls(): PaymentMonitoringControl[] {
    return PCI_MONITORING_CONTROLS.filter((c) => c.enabled);
  }

  evaluateMetric(metric: string, value: number): PaymentMonitoringAlert[] {
    this.lastValues.set(metric, value);
    const triggered: PaymentMonitoringAlert[] = [];

    for (const control of PCI_MONITORING_CONTROLS) {
      if (!control.enabled || control.metric !== metric) continue;

      const breached = this.checkThreshold(value, control.threshold, control.comparison);
      if (breached) {
        const alert: PaymentMonitoringAlert = {
          id: crypto.randomUUID(),
          controlId: control.id,
          controlName: control.name,
          triggeredAt: Date.now(),
          value,
          threshold: control.threshold,
          severity: control.severity,
          acknowledged: false,
        };
        this.alerts.push(alert);
        triggered.push(alert);
      }
    }

    return triggered;
  }

  private checkThreshold(value: number, threshold: number, comparison: string): boolean {
    switch (comparison) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      default:
        return false;
    }
  }

  acknowledgeAlert(alertId: string, userId: string): boolean {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (!alert || alert.acknowledged) return false;
    alert.acknowledged = true;
    alert.acknowledgedBy = userId;
    return true;
  }

  getActiveAlerts(): PaymentMonitoringAlert[] {
    return this.alerts.filter((a) => !a.acknowledged);
  }

  getAllAlerts(): PaymentMonitoringAlert[] {
    return [...this.alerts];
  }

  getCriticalAlerts(): PaymentMonitoringAlert[] {
    return this.alerts.filter((a) => a.severity === 'critical' && !a.acknowledged);
  }
}
