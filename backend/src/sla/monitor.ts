/**
 * backend/src/sla/monitor.ts
 *
 * Stateful SLA monitor: enrolls subscriptions on a tier, ingests request
 * outcomes and incidents, raises per-tier alerts while a period is running,
 * and issues credits exactly once when a period closes.
 *
 * Collaborators are injected so the monitor stays testable and reuses the
 * existing backend services:
 *  - credits go through `CreditService.issueCredit` (billing/creditService.ts)
 *  - alerts go through `AlertingService.dispatch` (notification/alerting.ts)
 *
 * Wire `check()` to a scheduler (e.g. every minute) for live alerting and
 * `closeCompletedPeriods()` to a daily job for credit issuance.
 */

import type { Alert, AlertSeverity } from '../../services/shared/types';
import {
  creditAmountFor,
  creditPercentFor,
  emptyRequestStats,
  evaluatePeriod,
  observeRequest,
  periodBounds,
  type Interval,
  type RequestStats,
} from './calculator';
import { SlaError } from './errors';
import { buildTierMap, DEFAULT_SLA_TIERS } from './tiers';
import type {
  SlaAlertSink,
  SlaCreditIssuer,
  SlaCreditRecord,
  SlaIncident,
  SlaLogger,
  SlaMetric,
  SlaMetrics,
  SlaPeriodReport,
  SlaSubscription,
  SlaTierPolicy,
} from './types';

export interface SlaMonitorOptions {
  creditIssuer: SlaCreditIssuer;
  alerts: SlaAlertSink;
  tiers?: readonly SlaTierPolicy[];
  /** Requests needed before latency / error rate are judged. Default 100. */
  minRequests?: number;
  /** Actor recorded on credit ledger entries. Default `system:sla`. */
  creditActor?: string;
  logger?: SlaLogger;
  metrics?: SlaMetrics;
  now?: () => number;
}

export interface RecordRequestInput {
  latencyMs: number;
  ok: boolean;
  /** Defaults to now. */
  at?: number;
}

export interface OpenIncidentInput {
  id?: string;
  /** Defaults to now. */
  start?: number;
  end?: number;
  subscriptionIds?: string[];
  maintenance?: boolean;
  description?: string;
}

export interface SlaMonitor {
  register(
    input: Omit<SlaSubscription, 'registeredAt'> & { registeredAt?: number }
  ): SlaSubscription;
  unregister(subscriptionId: string): void;
  getSubscription(subscriptionId: string): SlaSubscription | undefined;
  recordRequest(subscriptionId: string, input: RecordRequestInput): void;
  openIncident(input?: OpenIncidentInput): SlaIncident;
  resolveIncident(id: string, end?: number): SlaIncident;
  scheduleMaintenance(
    start: number,
    end: number,
    subscriptionIds?: string[],
    description?: string
  ): SlaIncident;
  listIncidents(): SlaIncident[];
  /** Period-to-date evaluation of the current period. */
  getStatus(subscriptionId: string): SlaPeriodReport;
  /** Evaluates every subscription and dispatches at-risk / breach alerts. */
  check(): Promise<SlaPeriodReport[]>;
  /** Evaluates a finished period and issues its credit once. */
  closePeriod(subscriptionId: string, periodStart: number): Promise<SlaCreditRecord>;
  /** Closes every finished, not-yet-settled period for every subscription. */
  closeCompletedPeriods(): Promise<SlaCreditRecord[]>;
  getCredits(subscriptionId: string): SlaCreditRecord[];
}

const noopMetrics: SlaMetrics = { increment: () => undefined, gauge: () => undefined };
const silentLogger: SlaLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };
const METRIC_LABEL: Record<SlaMetric, string> = {
  uptime: 'uptime',
  latency: 'p95 latency',
  error_rate: 'error rate',
};

export function createSlaMonitor(options: SlaMonitorOptions): SlaMonitor {
  const tiers = buildTierMap(options.tiers ?? DEFAULT_SLA_TIERS);
  const minRequests = options.minRequests ?? 100;
  const creditActor = options.creditActor ?? 'system:sla';
  const logger = options.logger ?? silentLogger;
  const metrics = options.metrics ?? noopMetrics;
  const now = options.now ?? Date.now;

  const subscriptions = new Map<string, SlaSubscription>();
  /** `${subscriptionId}:${periodStart}` → request stats for that period. */
  const requests = new Map<string, RequestStats>();
  const incidents = new Map<string, SlaIncident>();
  /** `${subscriptionId}:${periodStart}` → credit settlement. */
  const credits = new Map<string, SlaCreditRecord>();
  /** Alert keys already dispatched, so each alert fires once per period. */
  const alerted = new Set<string>();
  let incidentSeq = 0;

  const periodKey = (subscriptionId: string, periodStart: number) =>
    `${subscriptionId}:${periodStart}`;

  function requireSubscription(subscriptionId: string): SlaSubscription {
    const sub = subscriptions.get(subscriptionId);
    if (!sub)
      throw new SlaError(
        'unknown_subscription',
        `subscription "${subscriptionId}" is not monitored`
      );
    return sub;
  }

  function policyFor(sub: SlaSubscription): SlaTierPolicy {
    const policy = tiers.get(sub.tier);
    if (!policy) throw new SlaError('unknown_tier', `tier "${sub.tier}" is not configured`);
    return policy;
  }

  function affects(incident: SlaIncident, subscriptionId: string): boolean {
    return !incident.subscriptionIds || incident.subscriptionIds.includes(subscriptionId);
  }

  function intervalsFor(
    subscriptionId: string,
    maintenance: boolean,
    openUntil: number
  ): Interval[] {
    const out: Interval[] = [];
    for (const incident of incidents.values()) {
      if (incident.maintenance !== maintenance || !affects(incident, subscriptionId)) continue;
      out.push({ start: incident.start, end: incident.end ?? openUntil });
    }
    return out;
  }

  function evaluate(
    sub: SlaSubscription,
    periodStart: number,
    periodEnd: number,
    until: number
  ): SlaPeriodReport {
    return evaluatePeriod({
      subscriptionId: sub.subscriptionId,
      policy: policyFor(sub),
      periodStart,
      periodEnd,
      registeredAt: sub.registeredAt,
      evaluatedUntil: until,
      outages: intervalsFor(sub.subscriptionId, false, until),
      maintenance: intervalsFor(sub.subscriptionId, true, until),
      requests: requests.get(periodKey(sub.subscriptionId, periodStart)) ?? emptyRequestStats(),
      minRequests,
    });
  }

  function publishGauges(report: SlaPeriodReport): void {
    const labels = { subscription_id: report.subscriptionId, tier: report.tier };
    metrics.gauge('sla_uptime_percent', report.uptimePercent, labels);
    metrics.gauge('sla_downtime_budget_consumed_percent', report.budgetConsumedPercent, labels);
    if (report.p95LatencyMs !== null)
      metrics.gauge('sla_p95_latency_ms', report.p95LatencyMs, labels);
    if (report.errorRatePercent !== null)
      metrics.gauge('sla_error_rate_percent', report.errorRatePercent, labels);
  }

  async function sendAlert(
    key: string,
    alert: Omit<Alert, 'id' | 'timestamp' | 'resolved'>
  ): Promise<void> {
    if (alerted.has(key)) return;
    alerted.add(key);
    try {
      await options.alerts.dispatch({ ...alert, id: key, timestamp: now(), resolved: false });
      metrics.increment('sla_alerts_total', { rule: alert.ruleId, severity: alert.severity });
    } catch (err) {
      // Allow a retry on the next check rather than silently dropping it.
      alerted.delete(key);
      logger.error('SLA alert dispatch failed', { alertId: key, error: String(err) });
      metrics.increment('sla_alert_failures_total', { rule: alert.ruleId });
    }
  }

  async function alertOn(report: SlaPeriodReport, policy: SlaTierPolicy): Promise<void> {
    const base = `sla:${report.subscriptionId}:${report.periodStart}`;

    for (const metric of report.breaches) {
      await sendAlert(`${base}:breach:${metric}`, {
        severity: policy.breachAlertSeverity,
        ruleId: `sla-breach-${metric}`,
        title: `SLA breach (${policy.tier}): ${METRIC_LABEL[metric]}`,
        message: describeBreach(report, policy, metric),
      });
    }

    const atRisk =
      !report.breaches.includes('uptime') &&
      report.downtimeMs > 0 &&
      report.budgetConsumedPercent >= policy.atRiskBudgetPercent;
    if (atRisk) {
      const severity: AlertSeverity =
        SEVERITY_RANK[policy.breachAlertSeverity] > SEVERITY_RANK.warning ? 'warning' : 'info';
      await sendAlert(`${base}:at_risk:uptime`, {
        severity,
        ruleId: 'sla-at-risk-uptime',
        title: `SLA at risk (${policy.tier}): uptime`,
        message:
          `Subscription ${report.subscriptionId} has used ${report.budgetConsumedPercent}% of its ` +
          `downtime budget (${Math.round(report.downtimeMs / 1000)}s of ` +
          `${Math.round(report.downtimeBudgetMs / 1000)}s) this period.`,
      });
    }
  }

  async function settle(
    sub: SlaSubscription,
    periodStart: number,
    periodEnd: number
  ): Promise<SlaCreditRecord> {
    const key = periodKey(sub.subscriptionId, periodStart);
    const existing = credits.get(key);
    if (existing && existing.status !== 'failed') return existing;

    const policy = policyFor(sub);
    const report = existing?.report ?? evaluate(sub, periodStart, periodEnd, periodEnd);
    const creditPercent = creditPercentFor(policy, report);
    const amount = creditAmountFor(sub.periodFee, creditPercent);
    const record: SlaCreditRecord = {
      subscriptionId: sub.subscriptionId,
      accountId: sub.accountId,
      periodStart,
      periodEnd,
      creditPercent,
      amount,
      status: 'not_owed',
      attempts: (existing?.attempts ?? 0) + (amount > 0 ? 1 : 0),
      report,
    };

    if (amount > 0) {
      try {
        options.creditIssuer.issueCredit({
          accountId: sub.accountId,
          actor: creditActor,
          amount,
          reason:
            `SLA credit: ${policy.tier} tier, ${new Date(periodStart).toISOString().slice(0, 7)}, ` +
            `breached ${report.breaches.join(', ')} (${creditPercent}% of fee)`,
        });
        record.status = 'issued';
        record.issuedAt = now();
        metrics.increment('sla_credits_issued_total', { tier: policy.tier });
        metrics.gauge('sla_credit_amount', amount, {
          subscription_id: sub.subscriptionId,
          tier: policy.tier,
        });
        logger.info('SLA credit issued', {
          subscriptionId: sub.subscriptionId,
          periodStart,
          amount,
          creditPercent,
          breaches: report.breaches,
        });
      } catch (err) {
        record.status = 'failed';
        record.error = err instanceof Error ? err.message : String(err);
        metrics.increment('sla_credit_failures_total', { tier: policy.tier });
        logger.error('SLA credit issuance failed', {
          subscriptionId: sub.subscriptionId,
          periodStart,
          amount,
          attempt: record.attempts,
          error: record.error,
        });
        await sendAlert(
          `sla:${sub.subscriptionId}:${periodStart}:credit_failed:${record.attempts}`,
          {
            severity: 'warning',
            ruleId: 'sla-credit-failed',
            title: `SLA credit issuance failed (${policy.tier})`,
            message: `Could not issue ${amount} credit to subscription ${sub.subscriptionId}: ${record.error}. It will be retried.`,
          }
        );
      }
    }

    credits.set(key, record);
    metrics.increment('sla_periods_closed_total', {
      tier: policy.tier,
      compliant: String(report.compliant),
    });
    // Request stats are no longer needed once the period is settled.
    if (record.status !== 'failed') requests.delete(key);
    return record;
  }

  const monitor: SlaMonitor = {
    register(input) {
      if (subscriptions.has(input.subscriptionId)) {
        throw new SlaError(
          'duplicate_subscription',
          `subscription "${input.subscriptionId}" is already monitored`
        );
      }
      if (!tiers.has(input.tier))
        throw new SlaError('unknown_tier', `tier "${input.tier}" is not configured`);
      if (!input.accountId) throw new SlaError('invalid_input', 'accountId is required');
      if (!Number.isFinite(input.periodFee) || input.periodFee < 0) {
        throw new SlaError('invalid_input', 'periodFee must be a non-negative number');
      }
      const sub: SlaSubscription = { ...input, registeredAt: input.registeredAt ?? now() };
      subscriptions.set(sub.subscriptionId, sub);
      logger.info('SLA monitoring enabled', { subscriptionId: sub.subscriptionId, tier: sub.tier });
      metrics.gauge('sla_monitored_subscriptions', subscriptions.size);
      return { ...sub };
    },

    unregister(subscriptionId) {
      requireSubscription(subscriptionId);
      subscriptions.delete(subscriptionId);
      for (const key of [...requests.keys()]) {
        if (key.startsWith(`${subscriptionId}:`)) requests.delete(key);
      }
      metrics.gauge('sla_monitored_subscriptions', subscriptions.size);
    },

    getSubscription(subscriptionId) {
      const sub = subscriptions.get(subscriptionId);
      return sub ? { ...sub } : undefined;
    },

    recordRequest(subscriptionId, input) {
      requireSubscription(subscriptionId);
      if (!Number.isFinite(input.latencyMs) || input.latencyMs < 0) {
        throw new SlaError('invalid_input', 'latencyMs must be a non-negative number');
      }
      const at = input.at ?? now();
      const key = periodKey(subscriptionId, periodBounds(at).start);
      const stats = requests.get(key) ?? emptyRequestStats();
      observeRequest(stats, input.latencyMs, input.ok);
      requests.set(key, stats);
    },

    openIncident(input = {}) {
      const start = input.start ?? now();
      if (input.end !== undefined && input.end <= start) {
        throw new SlaError('invalid_input', 'incident end must be after its start');
      }
      for (const id of input.subscriptionIds ?? []) requireSubscription(id);
      const incident: SlaIncident = {
        id: input.id ?? `sla-incident-${++incidentSeq}`,
        start,
        end: input.end,
        subscriptionIds: input.subscriptionIds ? [...input.subscriptionIds] : undefined,
        maintenance: input.maintenance ?? false,
        description: input.description,
      };
      if (incidents.has(incident.id)) {
        throw new SlaError('invalid_input', `incident "${incident.id}" already exists`);
      }
      incidents.set(incident.id, incident);
      const kind = incident.maintenance ? 'maintenance' : 'outage';
      metrics.increment('sla_incidents_total', { kind });
      logger.warn(`SLA ${kind} recorded`, {
        incidentId: incident.id,
        start,
        end: incident.end,
        scope: incident.subscriptionIds ?? 'all',
      });
      return { ...incident };
    },

    resolveIncident(id, end) {
      const incident = incidents.get(id);
      if (!incident) throw new SlaError('unknown_incident', `incident "${id}" does not exist`);
      if (incident.end !== undefined)
        throw new SlaError('invalid_input', `incident "${id}" is already resolved`);
      const resolvedAt = end ?? now();
      if (resolvedAt <= incident.start)
        throw new SlaError('invalid_input', 'incident end must be after its start');
      incident.end = resolvedAt;
      logger.info('SLA incident resolved', {
        incidentId: id,
        durationMs: resolvedAt - incident.start,
      });
      return { ...incident };
    },

    scheduleMaintenance(start, end, subscriptionIds, description) {
      return monitor.openIncident({ start, end, subscriptionIds, maintenance: true, description });
    },

    listIncidents() {
      return [...incidents.values()].map((i) => ({ ...i }));
    },

    getStatus(subscriptionId) {
      const sub = requireSubscription(subscriptionId);
      const at = now();
      const { start, end } = periodBounds(at);
      return evaluate(sub, start, end, at);
    },

    async check() {
      const at = now();
      const { start, end } = periodBounds(at);
      const reports: SlaPeriodReport[] = [];
      for (const sub of subscriptions.values()) {
        const report = evaluate(sub, start, end, at);
        publishGauges(report);
        await alertOn(report, policyFor(sub));
        reports.push(report);
      }
      return reports;
    },

    async closePeriod(subscriptionId, periodStart) {
      const sub = requireSubscription(subscriptionId);
      const { start, end } = periodBounds(periodStart);
      if (start !== periodStart) {
        throw new SlaError('invalid_input', 'periodStart must be the first instant of a UTC month');
      }
      if (now() < end) throw new SlaError('period_open', 'the period has not finished yet');
      return settle(sub, start, end);
    },

    async closeCompletedPeriods() {
      const current = periodBounds(now()).start;
      const settled: SlaCreditRecord[] = [];
      for (const sub of subscriptions.values()) {
        let { start, end } = periodBounds(sub.registeredAt);
        while (start < current) {
          const existing = credits.get(periodKey(sub.subscriptionId, start));
          if (!existing || existing.status === 'failed')
            settled.push(await settle(sub, start, end));
          ({ start, end } = periodBounds(end));
        }
      }
      return settled;
    },

    getCredits(subscriptionId) {
      return [...credits.values()]
        .filter((c) => c.subscriptionId === subscriptionId)
        .sort((a, b) => a.periodStart - b.periodStart);
    },
  };
  return monitor;
}

function describeBreach(report: SlaPeriodReport, policy: SlaTierPolicy, metric: SlaMetric): string {
  const prefix = `Subscription ${report.subscriptionId} breached its ${policy.tier} SLA:`;
  switch (metric) {
    case 'uptime':
      return (
        `${prefix} ${Math.round(report.downtimeMs / 1000)}s of downtime exceeds the ` +
        `${Math.round(report.downtimeBudgetMs / 1000)}s budget for a ${policy.uptimeTargetPercent}% target.`
      );
    case 'latency':
      return `${prefix} p95 latency ${report.p95LatencyMs}ms exceeds the ${policy.p95LatencyTargetMs}ms target.`;
    case 'error_rate':
      return `${prefix} error rate ${report.errorRatePercent}% exceeds the ${policy.errorRateTargetPercent}% target.`;
  }
}
