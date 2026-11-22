/**
 * Shared SLA Monitoring and Breach Detection Service
 *
 * Tracks subscription service health, availability metrics, latency spikes,
 * error rate thresholds, and detects SLA breaches with credit penalty calculations.
 */

export type SlaBreachType = 'uptime_drop' | 'latency_spike' | 'error_rate_surge' | 'outage_duration';
export type SlaBreachSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface SlaTargetConfig {
  merchantId: string;
  uptimeTarget: number; // e.g., 99.9%
  maxLatencyMs: number; // e.g., 500ms
  maxErrorRatePercent: number; // e.g., 1.0%
  measurementIntervalSec: number; // e.g., 86400 (daily)
  penaltyCreditRateBps: number; // basis points credit per 0.1% uptime drop (e.g. 50 = 0.5%)
}

export interface SlaMetricPoint {
  timestamp: number;
  uptimePercentage: number;
  avgLatencyMs: number;
  errorRatePercent: number;
  totalRequests: number;
  failedRequests: number;
  downtimeSeconds: number;
}

export interface SlaBreachIncident {
  id: string;
  merchantId: string;
  breachType: SlaBreachType;
  severity: SlaBreachSeverity;
  targetValue: number;
  actualValue: number;
  detectedAt: Date;
  resolved: boolean;
  resolvedAt?: Date;
  creditPenaltyAmount: number;
  notes?: string;
}

export interface SlaComplianceReport {
  merchantId: string;
  uptimeTarget: number;
  currentUptime: number;
  compliant: boolean;
  activeBreachCount: number;
  totalBreachesCount: number;
  totalCreditsIssued: number;
  recentBreaches: SlaBreachIncident[];
  metricsHistory: SlaMetricPoint[];
}

export class SlaBreachDetector {
  /** Default SLA Targets */
  public static defaultTargetConfig(merchantId: string): SlaTargetConfig {
    return {
      merchantId,
      uptimeTarget: 99.9,
      maxLatencyMs: 500,
      maxErrorRatePercent: 1.0,
      measurementIntervalSec: 86400,
      penaltyCreditRateBps: 100, // 1% credit per 0.1% breach
    };
  }

  /**
   * Evaluate a set of SLA metrics against target configuration to detect breaches
   */
  public static evaluateBreaches(
    config: SlaTargetConfig,
    metrics: SlaMetricPoint[],
    monthlySubscriptionFee: number = 100
  ): SlaBreachIncident[] {
    const breaches: SlaBreachIncident[] = [];
    if (!metrics.length) return breaches;

    const latest = metrics[metrics.length - 1];

    // 1. Uptime Drop Detection
    if (latest.uptimePercentage < config.uptimeTarget) {
      const drop = config.uptimeTarget - latest.uptimePercentage;
      const severity: SlaBreachSeverity =
        drop > 5.0 ? 'critical' : drop > 2.0 ? 'high' : drop > 0.5 ? 'medium' : 'low';
      const creditPenalty = this.calculateCreditPenalty(drop, monthlySubscriptionFee, config.penaltyCreditRateBps);

      breaches.push({
        id: `br_uptime_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        merchantId: config.merchantId,
        breachType: 'uptime_drop',
        severity,
        targetValue: config.uptimeTarget,
        actualValue: Math.round(latest.uptimePercentage * 100) / 100,
        detectedAt: new Date(latest.timestamp),
        resolved: false,
        creditPenaltyAmount: creditPenalty,
        notes: `Uptime fell to ${latest.uptimePercentage.toFixed(2)}% (Target: ${config.uptimeTarget}%)`,
      });
    }

    // 2. Latency Spike Detection
    if (latest.avgLatencyMs > config.maxLatencyMs) {
      const spikeRatio = latest.avgLatencyMs / config.maxLatencyMs;
      const severity: SlaBreachSeverity = spikeRatio > 3.0 ? 'critical' : spikeRatio > 2.0 ? 'high' : 'medium';
      const creditPenalty = Math.round(monthlySubscriptionFee * 0.05 * 100) / 100; // Flat 5% credit penalty for latency breach

      breaches.push({
        id: `br_latency_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        merchantId: config.merchantId,
        breachType: 'latency_spike',
        severity,
        targetValue: config.maxLatencyMs,
        actualValue: Math.round(latest.avgLatencyMs),
        detectedAt: new Date(latest.timestamp),
        resolved: false,
        creditPenaltyAmount: creditPenalty,
        notes: `Average latency of ${Math.round(latest.avgLatencyMs)}ms exceeded threshold of ${config.maxLatencyMs}ms`,
      });
    }

    // 3. Error Rate Surge Detection
    if (latest.errorRatePercent > config.maxErrorRatePercent) {
      const severity: SlaBreachSeverity =
        latest.errorRatePercent > 10.0 ? 'critical' : latest.errorRatePercent > 5.0 ? 'high' : 'medium';
      const creditPenalty = Math.round(monthlySubscriptionFee * 0.10 * 100) / 100; // 10% credit penalty for high error rate

      breaches.push({
        id: `br_error_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        merchantId: config.merchantId,
        breachType: 'error_rate_surge',
        severity,
        targetValue: config.maxErrorRatePercent,
        actualValue: Math.round(latest.errorRatePercent * 100) / 100,
        detectedAt: new Date(latest.timestamp),
        resolved: false,
        creditPenaltyAmount: creditPenalty,
        notes: `Error rate reached ${latest.errorRatePercent.toFixed(2)}% (Max allowed: ${config.maxErrorRatePercent}%)`,
      });
    }

    return breaches;
  }

  /**
   * Calculate service credit penalty amount for uptime breaches
   */
  public static calculateCreditPenalty(
    uptimeDropPercent: number,
    subscriptionFee: number,
    rateBps: number
  ): number {
    const dropUnits = Math.ceil(uptimeDropPercent / 0.1);
    const penaltyRatio = (dropUnits * rateBps) / 10000;
    const rawPenalty = subscriptionFee * penaltyRatio;
    return Math.min(subscriptionFee, Math.round(rawPenalty * 100) / 100);
  }

  /**
   * Produce a complete SLA compliance report snapshot
   */
  public static generateComplianceReport(
    config: SlaTargetConfig,
    metrics: SlaMetricPoint[],
    breaches: SlaBreachIncident[]
  ): SlaComplianceReport {
    const latestMetric = metrics.length ? metrics[metrics.length - 1] : null;
    const currentUptime = latestMetric ? latestMetric.uptimePercentage : 100.0;
    const activeBreaches = breaches.filter((b) => !b.resolved);
    const totalCreditsIssued = breaches.reduce((sum, b) => sum + b.creditPenaltyAmount, 0);

    return {
      merchantId: config.merchantId,
      uptimeTarget: config.uptimeTarget,
      currentUptime: Math.round(currentUptime * 100) / 100,
      compliant: currentUptime >= config.uptimeTarget && activeBreaches.length === 0,
      activeBreachCount: activeBreaches.length,
      totalBreachesCount: breaches.length,
      totalCreditsIssued: Math.round(totalCreditsIssued * 100) / 100,
      recentBreaches: breaches.slice(-10),
      metricsHistory: metrics.slice(-30),
    };
  }
}
