/**
 * SLA Monitoring Service — real-time SLA tracking for subscription tiers.
 *
 * Accepts metric samples from instrumented endpoints, evaluates them against
 * per-tier targets, and records breaches. Callers wire breach records into
 * their alert channel of choice.
 *
 * Condensed from `backend/services/subscriptionSlaMonitoring.ts` with the
 * observability and alert-dispatch concerns separated.
 */

import { randomUUID } from 'crypto';
import { createPiiSafeLogger } from '../../../utils/logger';
import { metrics, MetricName } from '../observability';
import type {
  SlaBreachRecord,
  SlaMetricKind,
  SlaTarget,
  SubscriptionTier,
} from './types';

const logger = createPiiSafeLogger('subscriptions.lifecycle.sla');

// ── Default tier SLA targets ──────────────────────────────────────────────────

const DEFAULT_TARGETS: Record<SubscriptionTier, SlaTarget> = {
  free:       { uptimeTarget: 95,   maxResponseTimeMs: 5000, maxErrorRate: 10, maxLatencyMs: 3000, creditPercentage: 0 },
  basic:      { uptimeTarget: 99,   maxResponseTimeMs: 2000, maxErrorRate: 5,  maxLatencyMs: 1000, creditPercentage: 5 },
  standard:   { uptimeTarget: 99.5, maxResponseTimeMs: 1000, maxErrorRate: 2,  maxLatencyMs: 500,  creditPercentage: 10 },
  premium:    { uptimeTarget: 99.9, maxResponseTimeMs: 500,  maxErrorRate: 1,  maxLatencyMs: 300,  creditPercentage: 15 },
  enterprise: { uptimeTarget: 99.99,maxResponseTimeMs: 200,  maxErrorRate: 0.5,maxLatencyMs: 100,  creditPercentage: 25 },
};

// ── Metric sample ─────────────────────────────────────────────────────────────

export interface SlaMetricSample {
  subscriptionId: string;
  tier: SubscriptionTier;
  kind: SlaMetricKind;
  value: number;
  timestamp: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class SlaMonitoringService {
  private readonly breaches = new Map<string, SlaBreachRecord>();
  private readonly tierOverrides = new Map<SubscriptionTier, SlaTarget>();

  overrideTierTarget(tier: SubscriptionTier, target: SlaTarget): void {
    this.tierOverrides.set(tier, target);
  }

  targetFor(tier: SubscriptionTier): SlaTarget {
    return this.tierOverrides.get(tier) ?? DEFAULT_TARGETS[tier];
  }

  /**
   * Record a metric sample and return a breach record if the sample violates
   * the SLA target, or `undefined` if everything is within bounds.
   */
  record(sample: SlaMetricSample): SlaBreachRecord | undefined {
    const target = this.targetFor(sample.tier);
    const breach = this.evaluate(sample, target);
    if (!breach) return undefined;

    this.breaches.set(breach.id, breach);

    metrics.increment(MetricName.LIFECYCLE_SLA_BREACH, {
      tier: sample.tier,
      metricKind: sample.kind,
    });

    logger.warn('lifecycle.sla.breach', {
      subscriptionId: breach.subscriptionId,
      tier: breach.tier,
      metricKind: breach.metricKind,
      targetValue: breach.targetValue,
      actualValue: breach.actualValue,
      creditIssued: breach.creditIssued,
    });

    return breach;
  }

  /**
   * Acknowledge that a breach has been resolved.
   */
  resolve(breachId: string, resolvedAt = Date.now()): boolean {
    const breach = this.breaches.get(breachId);
    if (!breach) return false;
    this.breaches.set(breachId, { ...breach, resolvedAt });
    metrics.increment(MetricName.LIFECYCLE_SLA_RESOLVED, { tier: breach.tier });
    logger.info('lifecycle.sla.resolved', { breachId, subscriptionId: breach.subscriptionId });
    return true;
  }

  activeBreaches(subscriptionId?: string): SlaBreachRecord[] {
    const records = Array.from(this.breaches.values()).filter((b) => b.resolvedAt === null);
    return subscriptionId ? records.filter((b) => b.subscriptionId === subscriptionId) : records;
  }

  allBreaches(subscriptionId?: string): SlaBreachRecord[] {
    const records = Array.from(this.breaches.values());
    return subscriptionId ? records.filter((b) => b.subscriptionId === subscriptionId) : records;
  }

  summary(): {
    totalBreaches: number;
    activeBreaches: number;
    totalCreditsIssued: number;
  } {
    let active = 0;
    let totalCredits = 0;
    for (const b of this.breaches.values()) {
      if (b.resolvedAt === null) active++;
      totalCredits += b.creditIssued;
    }
    return {
      totalBreaches: this.breaches.size,
      activeBreaches: active,
      totalCreditsIssued: round2(totalCredits),
    };
  }

  // ── Evaluation logic ────────────────────────────────────────────────────────

  private evaluate(sample: SlaMetricSample, target: SlaTarget): SlaBreachRecord | undefined {
    let targetValue: number;
    let violated: boolean;

    switch (sample.kind) {
      case 'uptime':
        targetValue = target.uptimeTarget;
        violated = sample.value < targetValue;
        break;
      case 'response_time':
        targetValue = target.maxResponseTimeMs;
        violated = sample.value > targetValue;
        break;
      case 'error_rate':
        targetValue = target.maxErrorRate;
        violated = sample.value > targetValue;
        break;
      case 'latency':
        targetValue = target.maxLatencyMs;
        violated = sample.value > targetValue;
        break;
      case 'throughput':
        // Throughput breaches are domain-specific; skip by default.
        return undefined;
      default:
        return undefined;
    }

    if (!violated) return undefined;

    const deviation = round2(Math.abs(sample.value - targetValue) / (targetValue || 1) * 100);
    const creditIssued = round2(target.creditPercentage);

    return {
      id: randomUUID(),
      subscriptionId: sample.subscriptionId,
      tier: sample.tier,
      metricKind: sample.kind,
      targetValue,
      actualValue: sample.value,
      deviationPercent: deviation,
      creditIssued,
      detectedAt: sample.timestamp,
      resolvedAt: null,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const slaMonitoringService = new SlaMonitoringService();
