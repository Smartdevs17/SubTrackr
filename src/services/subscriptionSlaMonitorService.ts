/**
 * Subscription SLA Monitoring Service
 *
 * Provides real-time SLA monitoring for individual subscriptions, including:
 * - Per-tier SLA target enforcement
 * - Metric collection and compliance evaluation
 * - Automatic breach detection with severity classification
 * - SLA credit calculation and issuance
 * - Alert generation and escalation
 * - Analytics and reporting
 *
 * @see https://github.com/Smartdevs17/SubTrackr/issues/779
 */

import type {
  SubscriptionSlaConfig,
  SubscriptionSlaBreach,
  SubscriptionSlaAlert,
  SubscriptionSlaStatus,
  SubscriptionSlaAnalytics,
  SubscriptionSlaReport,
  SubscriptionSlaDashboard,
  SlaMetricSample,
  SlaMetricKind,
  SlaBreachSeverity,
  SubscriptionSlaTier,
  SlaEvaluationInput,
  SlaEvaluationResult,
  DEFAULT_SLA_TARGETS,
} from '../types/subscriptionSla';

// Re-export the default targets for consumers
export { DEFAULT_SLA_TARGETS } from '../types/subscriptionSla';

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Severity classification ───────────────────────────────────────────────────

/**
 * Determines breach severity based on how far the actual value deviates
 * from the SLA target.
 */
export function classifyBreachSeverity(
  deviationPercent: number,
  metricKind: SlaMetricKind
): SlaBreachSeverity {
  const absDeviation = Math.abs(deviationPercent);

  // Uptime breaches are more critical since they directly impact availability
  if (metricKind === 'uptime') {
    if (absDeviation >= 5) return 'critical';
    if (absDeviation >= 2) return 'major';
    if (absDeviation >= 1) return 'minor';
    return 'warning';
  }

  // Other metrics use wider thresholds
  if (absDeviation >= 50) return 'critical';
  if (absDeviation >= 25) return 'major';
  if (absDeviation >= 10) return 'minor';
  return 'warning';
}

// ── Credit calculation ────────────────────────────────────────────────────────

/**
 * Calculates the credit amount to issue for a given breach based on the
 * subscription tier's credit policy.
 */
export function calculateBreachCredit(
  severity: SlaBreachSeverity,
  creditPercentage: number,
  maxCreditCap: number
): number {
  if (creditPercentage <= 0) return 0;

  const severityMultiplier: Record<SlaBreachSeverity, number> = {
    warning: 0.25,
    minor: 0.5,
    major: 1.0,
    critical: 2.0,
  };

  const rawCredit = creditPercentage * severityMultiplier[severity];
  return Math.min(Math.round(rawCredit * 100) / 100, maxCreditCap);
}

// ── Metric evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluates whether a set of metric samples comply with the SLA targets
 * for a given subscription configuration.
 */
export function evaluateSubscriptionSla(input: SlaEvaluationInput): SlaEvaluationResult {
  const { config, metrics, existingBreaches } = input;
  const now = input.now ?? Date.now();
  const { targets } = config;

  // Partition metrics by kind
  const byKind = new Map<SlaMetricKind, SlaMetricSample[]>();
  for (const sample of metrics) {
    const list = byKind.get(sample.kind) ?? [];
    list.push(sample);
    byKind.set(sample.kind, list);
  }

  // Calculate aggregates
  const uptimeSamples = byKind.get('uptime') ?? [];
  const responseSamples = byKind.get('response_time') ?? [];
  const errorSamples = byKind.get('error_rate') ?? [];
  const latencySamples = byKind.get('latency') ?? [];

  const avg = (samples: SlaMetricSample[]): number =>
    samples.length > 0 ? samples.reduce((s, m) => s + m.value, 0) / samples.length : 0;

  const uptimePercentage = uptimeSamples.length > 0 ? avg(uptimeSamples) : 100;
  const avgResponseTimeMs = avg(responseSamples);
  const errorRate = avg(errorSamples);
  const avgLatencyMs = avg(latencySamples);

  // Detect breaches per metric
  const newBreaches: SubscriptionSlaBreach[] = [];
  const resolvedBreachIds: string[] = [];
  const alerts: SubscriptionSlaAlert[] = [];

  const checkMetric = (
    kind: SlaMetricKind,
    actual: number,
    target: number,
    higherIsBetter: boolean
  ) => {
    const breached = higherIsBetter ? actual < target : actual > target;
    const deviationPercent = target !== 0 ? ((actual - target) / target) * 100 : 0;
    const activeBreachForKind = existingBreaches.find(
      (b) =>
        b.metricKind === kind &&
        b.subscriptionId === config.subscriptionId &&
        b.resolvedAt === null
    );

    if (breached && !activeBreachForKind) {
      const severity = classifyBreachSeverity(deviationPercent, kind);
      const credit = calculateBreachCredit(
        severity,
        targets.creditPercentage,
        targets.maxCreditCap
      );

      const breach: SubscriptionSlaBreach = {
        id: generateId('sla-breach'),
        subscriptionId: config.subscriptionId,
        tier: config.tier,
        severity,
        metricKind: kind,
        targetValue: target,
        actualValue: Number(actual.toFixed(4)),
        deviationPercent: Number(deviationPercent.toFixed(2)),
        creditIssued: credit,
        detectedAt: now,
        resolvedAt: null,
        acknowledged: false,
        notes: '',
      };

      newBreaches.push(breach);

      // Generate alert for breach
      const alert: SubscriptionSlaAlert = {
        id: generateId('sla-alert'),
        breachId: breach.id,
        subscriptionId: config.subscriptionId,
        severity,
        title: `SLA Breach: ${formatMetricKind(kind)}`,
        message: buildAlertMessage(kind, actual, target, severity, config.tier),
        actionRequired: severity === 'critical' || severity === 'major',
        isRead: false,
        isResolved: false,
        sentAt: now,
        acknowledgedAt: null,
        resolvedAt: null,
      };

      alerts.push(alert);
    }

    // Resolve active breach if metric is now compliant
    if (!breached && activeBreachForKind) {
      resolvedBreachIds.push(activeBreachForKind.id);
    }
  };

  // Evaluate each metric against targets
  if (uptimeSamples.length > 0) {
    checkMetric('uptime', uptimePercentage, targets.uptimeTarget, true);
  }
  if (responseSamples.length > 0) {
    checkMetric('response_time', avgResponseTimeMs, targets.maxResponseTimeMs, false);
  }
  if (errorSamples.length > 0) {
    checkMetric('error_rate', errorRate, targets.maxErrorRate, false);
  }
  if (latencySamples.length > 0) {
    checkMetric('latency', avgLatencyMs, targets.maxLatencyMs, false);
  }

  // Build updated breaches array
  const updatedBreaches = existingBreaches
    .map((b) => (resolvedBreachIds.includes(b.id) ? { ...b, resolvedAt: now } : b))
    .concat(newBreaches);

  const activeBreaches = updatedBreaches.filter(
    (b) => b.subscriptionId === config.subscriptionId && b.resolvedAt === null
  );

  const allSubBreaches = updatedBreaches.filter(
    (b) => b.subscriptionId === config.subscriptionId
  );

  const totalCredits = allSubBreaches.reduce((sum, b) => sum + b.creditIssued, 0);

  const status: SubscriptionSlaStatus = {
    subscriptionId: config.subscriptionId,
    tier: config.tier,
    uptimePercentage: Number(uptimePercentage.toFixed(4)),
    avgResponseTimeMs: Number(avgResponseTimeMs.toFixed(2)),
    errorRate: Number(errorRate.toFixed(4)),
    avgLatencyMs: Number(avgLatencyMs.toFixed(2)),
    compliant: activeBreaches.length === 0,
    activeBreachCount: activeBreaches.length,
    totalBreachCount: allSubBreaches.length,
    creditBalance: totalCredits,
    lastCheckedAt: now,
  };

  return { status, breaches: updatedBreaches, newBreaches, resolvedBreachIds, alerts };
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * Aggregates analytics across all subscription SLA data.
 */
export function buildSubscriptionSlaAnalytics(
  statuses: SubscriptionSlaStatus[],
  breaches: SubscriptionSlaBreach[],
  days = 30
): SubscriptionSlaAnalytics {
  const totalSubscriptions = statuses.length;
  const compliantCount = statuses.filter((s) => s.compliant).length;
  const nonCompliantCount = totalSubscriptions - compliantCount;
  const averageUptime =
    totalSubscriptions > 0
      ? Number(
          (statuses.reduce((sum, s) => sum + s.uptimePercentage, 0) / totalSubscriptions).toFixed(2)
        )
      : 100;

  const totalBreaches = breaches.length;
  const totalCreditsIssued = breaches.reduce((sum, b) => sum + b.creditIssued, 0);

  // Mean Time to Resolution (in minutes)
  const resolved = breaches.filter((b) => b.resolvedAt !== null);
  const mttr =
    resolved.length > 0
      ? Number(
          (
            resolved.reduce((sum, b) => sum + (b.resolvedAt! - b.detectedAt), 0) /
            resolved.length /
            60_000
          ).toFixed(2)
        )
      : 0;

  // Breaches by severity
  const breachesBySeverity: Record<SlaBreachSeverity, number> = {
    warning: 0,
    minor: 0,
    major: 0,
    critical: 0,
  };
  for (const b of breaches) breachesBySeverity[b.severity]++;

  // Breaches by metric
  const breachesByMetric: Record<SlaMetricKind, number> = {
    uptime: 0,
    response_time: 0,
    error_rate: 0,
    latency: 0,
    throughput: 0,
  };
  for (const b of breaches) breachesByMetric[b.metricKind]++;

  // Breaches by tier
  const breachesByTier: Record<SubscriptionSlaTier, number> = {
    free: 0,
    basic: 0,
    standard: 0,
    premium: 0,
    enterprise: 0,
  };
  for (const b of breaches) breachesByTier[b.tier]++;

  // Compliance trend
  const now = Date.now();
  const complianceTrend: Array<{ date: string; compliance: number; breaches: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = now - i * 86_400_000;
    const dayEnd = dayStart + 86_400_000;
    const dateStr = new Date(dayStart).toISOString().split('T')[0];
    const dayBreaches = breaches.filter((b) => b.detectedAt >= dayStart && b.detectedAt < dayEnd);
    complianceTrend.push({
      date: dateStr,
      compliance: averageUptime,
      breaches: dayBreaches.length,
    });
  }

  // Top breached subscriptions
  const subBreachMap = new Map<string, { tier: SubscriptionSlaTier; count: number }>();
  for (const b of breaches) {
    const entry = subBreachMap.get(b.subscriptionId) ?? { tier: b.tier, count: 0 };
    entry.count++;
    subBreachMap.set(b.subscriptionId, entry);
  }
  const topBreachedSubscriptions = Array.from(subBreachMap.entries())
    .map(([subscriptionId, data]) => {
      const s = statuses.find((st) => st.subscriptionId === subscriptionId);
      return {
        subscriptionId,
        tier: data.tier,
        breachCount: data.count,
        compliance: s?.uptimePercentage ?? 0,
      };
    })
    .sort((a, b) => b.breachCount - a.breachCount)
    .slice(0, 10);

  return {
    totalSubscriptions,
    compliantCount,
    nonCompliantCount,
    averageUptime,
    totalBreaches,
    totalCreditsIssued,
    mttr,
    breachesBySeverity,
    breachesByMetric,
    breachesByTier,
    complianceTrend,
    topBreachedSubscriptions,
  };
}

// ── Report generation ─────────────────────────────────────────────────────────

/**
 * Generates a structured SLA report for a given period.
 */
export function generateSubscriptionSlaReport(
  reportType: 'daily' | 'weekly' | 'monthly' | 'quarterly',
  periodStart: number,
  periodEnd: number,
  statuses: SubscriptionSlaStatus[],
  breaches: SubscriptionSlaBreach[]
): SubscriptionSlaReport {
  const periodBreaches = breaches.filter(
    (b) => b.detectedAt >= periodStart && b.detectedAt <= periodEnd
  );
  const analytics = buildSubscriptionSlaAnalytics(statuses, periodBreaches);
  const recommendations = generateRecommendations(analytics, periodBreaches);

  return {
    id: generateId('sla-report'),
    reportType,
    periodStart,
    periodEnd,
    analytics,
    breaches: periodBreaches,
    recommendations,
    generatedAt: Date.now(),
  };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

/**
 * Builds a dashboard overview of subscription SLA health.
 */
export function buildSubscriptionSlaDashboard(
  statuses: SubscriptionSlaStatus[],
  breaches: SubscriptionSlaBreach[],
  alerts: SubscriptionSlaAlert[]
): SubscriptionSlaDashboard {
  const total = statuses.length;
  const compliant = statuses.filter((s) => s.compliant).length;
  const activeBreaches = breaches.filter((b) => b.resolvedAt === null);

  // Status breakdown based on active breach severity
  let atRisk = 0;
  let breachedCount = 0;
  let critical = 0;

  for (const s of statuses) {
    if (s.compliant) continue;
    const subBreaches = activeBreaches.filter((b) => b.subscriptionId === s.subscriptionId);
    const hasCritical = subBreaches.some((b) => b.severity === 'critical');
    const hasMajor = subBreaches.some((b) => b.severity === 'major');

    if (hasCritical) critical++;
    else if (hasMajor) breachedCount++;
    else atRisk++;
  }

  const recentBreaches = [...activeBreaches]
    .sort((a, b) => b.detectedAt - a.detectedAt)
    .slice(0, 10);

  const recentAlerts = [...alerts]
    .filter((a) => !a.isResolved)
    .sort((a, b) => b.sentAt - a.sentAt)
    .slice(0, 10);

  const creditsIssued = breaches.reduce((sum, b) => sum + b.creditIssued, 0);

  // Compliance trend (last 7 days)
  const now = Date.now();
  const complianceTrend: Array<{ date: string; compliance: number; breaches: number }> = [];
  const avgUptime =
    total > 0
      ? statuses.reduce((sum, s) => sum + s.uptimePercentage, 0) / total
      : 100;

  for (let i = 6; i >= 0; i--) {
    const dayStart = now - i * 86_400_000;
    const dayEnd = dayStart + 86_400_000;
    const dayBreaches = breaches.filter((b) => b.detectedAt >= dayStart && b.detectedAt < dayEnd);
    complianceTrend.push({
      date: new Date(dayStart).toISOString().split('T')[0],
      compliance: Number(avgUptime.toFixed(2)),
      breaches: dayBreaches.length,
    });
  }

  return {
    overview: {
      totalSubscriptions: total,
      compliantPercentage: total > 0 ? Number(((compliant / total) * 100).toFixed(2)) : 100,
      activeBreaches: activeBreaches.length,
      creditsIssued: Number(creditsIssued.toFixed(2)),
    },
    statusBreakdown: {
      compliant,
      atRisk,
      breached: breachedCount,
      critical,
    },
    recentBreaches,
    recentAlerts,
    complianceTrend,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function formatMetricKind(kind: SlaMetricKind): string {
  const labels: Record<SlaMetricKind, string> = {
    uptime: 'Uptime',
    response_time: 'Response Time',
    error_rate: 'Error Rate',
    latency: 'Latency',
    throughput: 'Throughput',
  };
  return labels[kind] ?? kind;
}

function buildAlertMessage(
  kind: SlaMetricKind,
  actual: number,
  target: number,
  severity: SlaBreachSeverity,
  tier: SubscriptionSlaTier
): string {
  const kindLabel = formatMetricKind(kind);
  const units: Record<SlaMetricKind, string> = {
    uptime: '%',
    response_time: 'ms',
    error_rate: '%',
    latency: 'ms',
    throughput: 'req/s',
  };
  const unit = units[kind] ?? '';

  return (
    `[${severity.toUpperCase()}] ${kindLabel} SLA breach detected for ${tier} tier subscription. ` +
    `Target: ${target}${unit}, Actual: ${actual.toFixed(2)}${unit}. ` +
    `Deviation: ${(((actual - target) / target) * 100).toFixed(2)}%. ` +
    `Immediate action ${severity === 'critical' || severity === 'major' ? 'required' : 'recommended'}.`
  );
}

function generateRecommendations(
  analytics: SubscriptionSlaAnalytics,
  breaches: SubscriptionSlaBreach[]
): string[] {
  const recs: string[] = [];

  if (analytics.averageUptime < 99) {
    recs.push(
      `Average uptime is ${analytics.averageUptime}%, below the 99% industry standard. ` +
      'Investigate infrastructure reliability and redundancy.'
    );
  }

  if (analytics.breachesBySeverity.critical > 0) {
    recs.push(
      `${analytics.breachesBySeverity.critical} critical breach(es) detected. ` +
      'Prioritize root cause analysis and immediate remediation.'
    );
  }

  if (analytics.mttr > 60) {
    recs.push(
      `Mean time to resolution is ${analytics.mttr.toFixed(0)} minutes. ` +
      'Consider implementing automated failover and faster incident response procedures.'
    );
  }

  if (analytics.breachesByMetric.response_time > 5) {
    recs.push(
      'Multiple response time SLA breaches detected. ' +
      'Review API performance, caching strategies, and database query optimization.'
    );
  }

  if (analytics.breachesByMetric.error_rate > 3) {
    recs.push(
      'Recurring error rate SLA breaches. ' +
      'Implement circuit breakers, retry logic, and improved error handling.'
    );
  }

  const enterpriseBreaches = breaches.filter((b) => b.tier === 'enterprise');
  if (enterpriseBreaches.length > 0) {
    recs.push(
      `${enterpriseBreaches.length} breach(es) affecting enterprise tier subscriptions. ` +
      'Enterprise SLAs carry the highest credit obligations — address immediately.'
    );
  }

  if (recs.length === 0) {
    recs.push(
      'All subscription SLAs are within acceptable limits. Continue monitoring for early warning signs.'
    );
  }

  return recs;
}
