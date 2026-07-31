/**
 * Backend Subscription SLA Monitoring Service
 *
 * Server-side service that orchestrates real-time SLA monitoring for
 * subscriptions, integrates with the alerting system, and provides
 * periodic SLA health checks.
 *
 * Designed to run as a background service that:
 * 1. Accepts metric samples from instrumented endpoints
 * 2. Evaluates SLA compliance in real-time
 * 3. Detects breaches and dispatches alerts
 * 4. Generates periodic SLA reports
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/779
 */

import type { AlertChannelConfig } from '../services/types';
import { AlertingService } from '../services/alerting';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SlaMetricKind = 'uptime' | 'response_time' | 'error_rate' | 'latency' | 'throughput';
export type SlaBreachSeverity = 'warning' | 'minor' | 'major' | 'critical';
export type SubscriptionTier = 'free' | 'basic' | 'standard' | 'premium' | 'enterprise';

export interface SubscriptionSlaTarget {
  uptimeTarget: number;
  maxResponseTimeMs: number;
  maxErrorRate: number;
  maxLatencyMs: number;
  creditPercentage: number;
  maxCreditCap: number;
}

export interface SlaMetricSample {
  kind: SlaMetricKind;
  value: number;
  timestamp: number;
  subscriptionId: string;
}

export interface SlaBreachRecord {
  id: string;
  subscriptionId: string;
  tier: SubscriptionTier;
  severity: SlaBreachSeverity;
  metricKind: SlaMetricKind;
  targetValue: number;
  actualValue: number;
  deviationPercent: number;
  creditIssued: number;
  detectedAt: number;
  resolvedAt: number | null;
  acknowledged: boolean;
}

export interface SlaSubscriptionConfig {
  subscriptionId: string;
  tier: SubscriptionTier;
  targets: SubscriptionSlaTarget;
  checkIntervalMs: number;
  alertContacts: string[];
}

export interface SlaHealthSummary {
  totalSubscriptions: number;
  compliantCount: number;
  activeBreaches: number;
  averageUptime: number;
  totalCreditsIssued: number;
}

// ── Default tier targets ──────────────────────────────────────────────────────

const DEFAULT_TARGETS: Record<SubscriptionTier, SubscriptionSlaTarget> = {
  free: {
    uptimeTarget: 95,
    maxResponseTimeMs: 5000,
    maxErrorRate: 10,
    maxLatencyMs: 3000,
    creditPercentage: 0,
    maxCreditCap: 0,
  },
  basic: {
    uptimeTarget: 99,
    maxResponseTimeMs: 2000,
    maxErrorRate: 5,
    maxLatencyMs: 1500,
    creditPercentage: 5,
    maxCreditCap: 50,
  },
  standard: {
    uptimeTarget: 99.5,
    maxResponseTimeMs: 1000,
    maxErrorRate: 2,
    maxLatencyMs: 800,
    creditPercentage: 10,
    maxCreditCap: 100,
  },
  premium: {
    uptimeTarget: 99.9,
    maxResponseTimeMs: 500,
    maxErrorRate: 1,
    maxLatencyMs: 300,
    creditPercentage: 15,
    maxCreditCap: 250,
  },
  enterprise: {
    uptimeTarget: 99.99,
    maxResponseTimeMs: 200,
    maxErrorRate: 0.1,
    maxLatencyMs: 100,
    creditPercentage: 25,
    maxCreditCap: 500,
  },
};

// ── Service ───────────────────────────────────────────────────────────────────

export class SubscriptionSlaMonitoringService {
  private configs = new Map<string, SlaSubscriptionConfig>();
  private samples = new Map<string, SlaMetricSample[]>();
  private breaches: SlaBreachRecord[] = [];
  private alerting: AlertingService;
  private checkTimers = new Map<string, ReturnType<typeof setInterval>>();

  /** Maximum metric samples retained per subscription */
  private readonly maxSamplesPerSub: number;

  constructor(
    alertChannels: AlertChannelConfig[] = [{ type: 'console' }],
    maxSamplesPerSub = 500
  ) {
    this.alerting = new AlertingService(alertChannels);
    this.maxSamplesPerSub = maxSamplesPerSub;
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  /**
   * Register or update SLA monitoring for a subscription.
   */
  configureSubscription(
    subscriptionId: string,
    tier: SubscriptionTier,
    overrides?: Partial<SubscriptionSlaTarget>,
    alertContacts: string[] = [],
    checkIntervalMs = 300_000
  ): SlaSubscriptionConfig {
    const targets = { ...DEFAULT_TARGETS[tier], ...overrides };
    const config: SlaSubscriptionConfig = {
      subscriptionId,
      tier,
      targets,
      checkIntervalMs,
      alertContacts,
    };

    this.configs.set(subscriptionId, config);

    // Set up periodic SLA checks
    this.startPeriodicCheck(subscriptionId, checkIntervalMs);

    return config;
  }

  /**
   * Remove SLA monitoring for a subscription.
   */
  removeSubscription(subscriptionId: string): void {
    this.configs.delete(subscriptionId);
    this.samples.delete(subscriptionId);
    this.breaches = this.breaches.filter((b) => b.subscriptionId !== subscriptionId);

    const timer = this.checkTimers.get(subscriptionId);
    if (timer) {
      clearInterval(timer);
      this.checkTimers.delete(subscriptionId);
    }
  }

  // ── Metric ingestion ──────────────────────────────────────────────────────

  /**
   * Record a metric sample for a subscription.
   * Automatically triggers SLA evaluation.
   */
  recordMetric(sample: SlaMetricSample): SlaBreachRecord | null {
    const existing = this.samples.get(sample.subscriptionId) ?? [];
    existing.push(sample);

    // Trim to max samples
    if (existing.length > this.maxSamplesPerSub) {
      existing.splice(0, existing.length - this.maxSamplesPerSub);
    }

    this.samples.set(sample.subscriptionId, existing);
    return this._evaluateMetric(sample);
  }

  /**
   * Record multiple metric samples at once.
   */
  recordMetricBatch(samples: SlaMetricSample[]): SlaBreachRecord[] {
    const newBreaches: SlaBreachRecord[] = [];
    for (const sample of samples) {
      const breach = this.recordMetric(sample);
      if (breach) newBreaches.push(breach);
    }
    return newBreaches;
  }

  // ── Breach management ─────────────────────────────────────────────────────

  /**
   * Get all active (unresolved) breaches.
   */
  getActiveBreaches(): SlaBreachRecord[] {
    return this.breaches.filter((b) => b.resolvedAt === null);
  }

  /**
   * Get breaches for a specific subscription.
   */
  getBreachesForSubscription(subscriptionId: string): SlaBreachRecord[] {
    return this.breaches.filter((b) => b.subscriptionId === subscriptionId);
  }

  /**
   * Acknowledge a breach.
   */
  acknowledgeBreach(breachId: string): boolean {
    const breach = this.breaches.find((b) => b.id === breachId);
    if (!breach) return false;
    breach.acknowledged = true;
    return true;
  }

  /**
   * Resolve a breach.
   */
  resolveBreach(breachId: string): boolean {
    const breach = this.breaches.find((b) => b.id === breachId);
    if (!breach) return false;
    breach.resolvedAt = Date.now();
    return true;
  }

  // ── Health & analytics ────────────────────────────────────────────────────

  /**
   * Get a summary of SLA health across all monitored subscriptions.
   */
  getHealthSummary(): SlaHealthSummary {
    const configList = Array.from(this.configs.values());
    const total = configList.length;
    const activeBreaches = this.getActiveBreaches();

    const subscriptionsWithBreaches = new Set(activeBreaches.map((b) => b.subscriptionId));
    const compliantCount = total - subscriptionsWithBreaches.size;

    const totalCreditsIssued = this.breaches.reduce((sum, b) => sum + b.creditIssued, 0);

    // Calculate average uptime from recent samples
    let uptimeSum = 0;
    let uptimeCount = 0;
    for (const [, samples] of this.samples) {
      const uptimeSamples = samples.filter((s) => s.kind === 'uptime');
      if (uptimeSamples.length > 0) {
        const avg = uptimeSamples.reduce((s, m) => s + m.value, 0) / uptimeSamples.length;
        uptimeSum += avg;
        uptimeCount++;
      }
    }

    return {
      totalSubscriptions: total,
      compliantCount,
      activeBreaches: activeBreaches.length,
      averageUptime: uptimeCount > 0 ? Number((uptimeSum / uptimeCount).toFixed(4)) : 100,
      totalCreditsIssued: Number(totalCreditsIssued.toFixed(2)),
    };
  }

  /**
   * Get all registered subscription configurations.
   */
  getConfigs(): SlaSubscriptionConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Get all breaches.
   */
  getAllBreaches(): SlaBreachRecord[] {
    return [...this.breaches];
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Stop all periodic checks and release resources.
   */
  shutdown(): void {
    for (const [, timer] of this.checkTimers) {
      clearInterval(timer);
    }
    this.checkTimers.clear();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private startPeriodicCheck(subscriptionId: string, intervalMs: number): void {
    // Clear existing timer
    const existing = this.checkTimers.get(subscriptionId);
    if (existing) clearInterval(existing);

    const timer = setInterval(() => {
      this._runPeriodicCheck(subscriptionId);
    }, intervalMs);

    this.checkTimers.set(subscriptionId, timer);
  }

  private _runPeriodicCheck(subscriptionId: string): void {
    const config = this.configs.get(subscriptionId);
    if (!config) return;

    const samples = this.samples.get(subscriptionId) ?? [];

    // Check each metric kind against targets
    const metricKinds: SlaMetricKind[] = ['uptime', 'response_time', 'error_rate', 'latency'];
    for (const kind of metricKinds) {
      const kindSamples = samples.filter((s) => s.kind === kind);
      if (kindSamples.length === 0) continue;

      const avg = kindSamples.reduce((s, m) => s + m.value, 0) / kindSamples.length;
      const syntheticSample: SlaMetricSample = {
        kind,
        value: avg,
        timestamp: Date.now(),
        subscriptionId,
      };
      this._evaluateMetric(syntheticSample);
    }
  }

  private _evaluateMetric(sample: SlaMetricSample): SlaBreachRecord | null {
    const config = this.configs.get(sample.subscriptionId);
    if (!config) return null;

    const { targets } = config;
    let target: number;
    let breached: boolean;

    switch (sample.kind) {
      case 'uptime':
        target = targets.uptimeTarget;
        breached = sample.value < target;
        break;
      case 'response_time':
        target = targets.maxResponseTimeMs;
        breached = sample.value > target;
        break;
      case 'error_rate':
        target = targets.maxErrorRate;
        breached = sample.value > target;
        break;
      case 'latency':
        target = targets.maxLatencyMs;
        breached = sample.value > target;
        break;
      default:
        return null;
    }

    if (!breached) {
      // Auto-resolve active breach for this metric if now compliant
      const activeBreach = this.breaches.find(
        (b) =>
          b.subscriptionId === sample.subscriptionId &&
          b.metricKind === sample.kind &&
          b.resolvedAt === null
      );
      if (activeBreach) {
        activeBreach.resolvedAt = Date.now();
      }
      return null;
    }

    // Check if there's already an active breach for this metric
    const existingBreach = this.breaches.find(
      (b) =>
        b.subscriptionId === sample.subscriptionId &&
        b.metricKind === sample.kind &&
        b.resolvedAt === null
    );
    if (existingBreach) return null;

    // Create new breach
    const deviationPercent = target !== 0 ? ((sample.value - target) / target) * 100 : 0;
    const severity = this._classifySeverity(Math.abs(deviationPercent), sample.kind);
    const credit = this._calculateCredit(severity, targets.creditPercentage, targets.maxCreditCap);

    const breach: SlaBreachRecord = {
      id: `sla-breach-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      subscriptionId: sample.subscriptionId,
      tier: config.tier,
      severity,
      metricKind: sample.kind,
      targetValue: target,
      actualValue: Number(sample.value.toFixed(4)),
      deviationPercent: Number(deviationPercent.toFixed(2)),
      creditIssued: credit,
      detectedAt: Date.now(),
      resolvedAt: null,
      acknowledged: false,
    };

    this.breaches.push(breach);

    // Dispatch alert
    void this.alerting.dispatch({
      id: `sla-alert-${breach.id}`,
      severity: severity === 'critical' ? 'critical' : severity === 'major' ? 'warning' : 'info',
      title: `SLA Breach: ${this._formatMetricKind(sample.kind)} (${config.tier} tier)`,
      message:
        `Subscription ${sample.subscriptionId} breached ${this._formatMetricKind(sample.kind)} SLA. ` +
        `Target: ${target}, Actual: ${sample.value.toFixed(2)}, ` +
        `Deviation: ${deviationPercent.toFixed(2)}%. Credit issued: ${credit}.`,
      timestamp: Date.now(),
      resolved: false,
      ruleId: `sla-${sample.kind}`,
    });

    return breach;
  }

  private _classifySeverity(
    absDeviationPercent: number,
    kind: SlaMetricKind
  ): SlaBreachSeverity {
    if (kind === 'uptime') {
      if (absDeviationPercent >= 5) return 'critical';
      if (absDeviationPercent >= 2) return 'major';
      if (absDeviationPercent >= 1) return 'minor';
      return 'warning';
    }

    if (absDeviationPercent >= 50) return 'critical';
    if (absDeviationPercent >= 25) return 'major';
    if (absDeviationPercent >= 10) return 'minor';
    return 'warning';
  }

  private _calculateCredit(
    severity: SlaBreachSeverity,
    creditPercentage: number,
    maxCreditCap: number
  ): number {
    if (creditPercentage <= 0) return 0;

    const multiplier: Record<SlaBreachSeverity, number> = {
      warning: 0.25,
      minor: 0.5,
      major: 1.0,
      critical: 2.0,
    };

    const rawCredit = creditPercentage * multiplier[severity];
    return Math.min(Math.round(rawCredit * 100) / 100, maxCreditCap);
  }

  private _formatMetricKind(kind: SlaMetricKind): string {
    const labels: Record<SlaMetricKind, string> = {
      uptime: 'Uptime',
      response_time: 'Response Time',
      error_rate: 'Error Rate',
      latency: 'Latency',
      throughput: 'Throughput',
    };
    return labels[kind] ?? kind;
  }
}
