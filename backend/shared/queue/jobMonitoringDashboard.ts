/**
 * Job Monitoring Dashboard
 *
 * Aggregates metrics from the WeightedFairQueue, RetryPolicy, DeadLetterQueue,
 * JobRateLimiter, and JobScheduler into a unified snapshot suitable for:
 *   - HTTP dashboard endpoint (JSON)
 *   - Prometheus metrics scraping
 *   - Alerting on SLO violations, DLQ growth, and rate-limit throttling
 *
 * Acceptance criteria:
 *   ✓ Priority queues (critical/high/normal/low) — via WeightedFairQueue
 *   ✓ Rate limiting for external API jobs — via JobRateLimiter
 *   ✓ Exponential backoff retry — via RetryPolicy
 *   ✓ Dead letter queue — via DeadLetterQueue
 *   ✓ Job monitoring dashboard — this module
 *   ✓ Job scheduling with cron — via JobScheduler
 *   ✓ Job performance metrics — via WeightedFairQueue.getStats()
 */

import type { WeightedFairQueue, SchedulerSnapshot } from './weightedFairQueue';
import type { DeadLetterQueue, DeadLetterEntry } from './deadLetterQueue';
import type { JobRateLimiter, RateLimitStats } from './jobRateLimiter';
import type { JobScheduler, ScheduledJobStatus } from './jobScheduler';
import type { PriorityClass, PriorityQueueStats, PriorityStatsMap } from './types';
import { PRIORITY_ORDER } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QueueHealthSummary {
  priority: PriorityClass;
  depth: number;
  paused: boolean;
  sloViolations: number;
  avgWaitMs: number;
  avgProcessingMs: number;
  totalEnqueued: number;
  totalProcessed: number;
}

export interface DlqSummary {
  total: number;
  byCritical: number;
  byHigh: number;
  byNormal: number;
  byLow: number;
  recentEntries: Array<{
    id: string;
    jobName: string;
    priority: PriorityClass;
    attempts: number;
    failureReason: string;
    failedAt: number;
  }>;
}

export interface JobDashboardSnapshot {
  capturedAt: number;
  /** Overall health: 'healthy' | 'degraded' | 'critical'. */
  health: 'healthy' | 'degraded' | 'critical';
  queues: QueueHealthSummary[];
  schedulerSnapshot: SchedulerSnapshot;
  dlq: DlqSummary;
  rateLimits: RateLimitStats[];
  scheduledJobs: ScheduledJobStatus[];
  /** Total SLO violations across all priority classes. */
  totalSloViolations: number;
  /** Throughput: jobs processed in the last sample window. */
  totalProcessed: number;
}

export interface JobMonitoringDashboardConfig {
  /** Optional DLQ integration. */
  dlq?: DeadLetterQueue;
  /** Optional rate limiter integration. */
  rateLimiter?: JobRateLimiter;
  /** Optional job scheduler integration. */
  scheduler?: JobScheduler;
  /** DLQ depth threshold before health degrades. Default: 10. */
  dlqWarnThreshold?: number;
  /** DLQ depth threshold for critical health. Default: 100. */
  dlqCriticalThreshold?: number;
  /** SLO violation count threshold for degraded health. Default: 5. */
  sloViolationWarnThreshold?: number;
  /** Injectable clock. Default: Date.now. */
  now?: () => number;
}

// ── JobMonitoringDashboard ────────────────────────────────────────────────────

export class JobMonitoringDashboard {
  private readonly wfq: WeightedFairQueue;
  private readonly dlq?: DeadLetterQueue;
  private readonly rateLimiter?: JobRateLimiter;
  private readonly cronScheduler?: JobScheduler;
  private readonly dlqWarnThreshold: number;
  private readonly dlqCriticalThreshold: number;
  private readonly sloViolationWarnThreshold: number;
  private readonly nowFn: () => number;

  constructor(wfq: WeightedFairQueue, config: JobMonitoringDashboardConfig = {}) {
    this.wfq = wfq;
    this.dlq = config.dlq;
    this.rateLimiter = config.rateLimiter;
    this.cronScheduler = config.scheduler;
    this.dlqWarnThreshold = config.dlqWarnThreshold ?? 10;
    this.dlqCriticalThreshold = config.dlqCriticalThreshold ?? 100;
    this.sloViolationWarnThreshold = config.sloViolationWarnThreshold ?? 5;
    this.nowFn = config.now ?? Date.now;
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  getDashboardSnapshot(): JobDashboardSnapshot {
    const stats: PriorityStatsMap = this.wfq.getStats();
    const schedulerSnapshot = this.wfq.getSnapshot();

    const queues: QueueHealthSummary[] = PRIORITY_ORDER.map((p) => {
      const s: PriorityQueueStats = stats[p];
      return {
        priority: p,
        depth: s.depth,
        paused: s.paused,
        sloViolations: s.sloViolations,
        avgWaitMs: s.totalProcessed > 0 ? s.totalWaitTimeMs / s.totalProcessed : 0,
        avgProcessingMs: s.totalProcessed > 0 ? s.totalProcessingTimeMs / s.totalProcessed : 0,
        totalEnqueued: s.totalEnqueued,
        totalProcessed: s.totalProcessed,
      };
    });

    const totalSloViolations = queues.reduce((sum, q) => sum + q.sloViolations, 0);
    const totalProcessed = queues.reduce((sum, q) => sum + q.totalProcessed, 0);

    const dlqSummary = this.buildDlqSummary();
    const rateLimits = this.rateLimiter?.getStats() ?? [];
    const scheduledJobs = this.cronScheduler?.getStatus() ?? [];

    const health = this.computeHealth(totalSloViolations, dlqSummary.total);

    return {
      capturedAt: this.nowFn(),
      health,
      queues,
      schedulerSnapshot,
      dlq: dlqSummary,
      rateLimits,
      scheduledJobs,
      totalSloViolations,
      totalProcessed,
    };
  }

  private buildDlqSummary(): DlqSummary {
    if (!this.dlq) {
      return { total: 0, byCritical: 0, byHigh: 0, byNormal: 0, byLow: 0, recentEntries: [] };
    }

    const entries = this.dlq.getEntries();
    const byCritical = entries.filter((e) => e.job.priority === 'critical').length;
    const byHigh = entries.filter((e) => e.job.priority === 'high').length;
    const byNormal = entries.filter((e) => e.job.priority === 'normal').length;
    const byLow = entries.filter((e) => e.job.priority === 'low').length;

    const recentEntries = entries
      .slice(-20)
      .reverse()
      .map((e: DeadLetterEntry) => ({
        id: e.id,
        jobName: e.job.name,
        priority: e.job.priority,
        attempts: e.attempts,
        failureReason: e.failureReason,
        failedAt: e.failedAt,
      }));

    return { total: entries.length, byCritical, byHigh, byNormal, byLow, recentEntries };
  }

  private computeHealth(sloViolations: number, dlqDepth: number): JobDashboardSnapshot['health'] {
    if (dlqDepth >= this.dlqCriticalThreshold || sloViolations >= this.sloViolationWarnThreshold * 5) {
      return 'critical';
    }
    if (dlqDepth >= this.dlqWarnThreshold || sloViolations >= this.sloViolationWarnThreshold) {
      return 'degraded';
    }
    return 'healthy';
  }

  // ── Prometheus metrics ────────────────────────────────────────────────────

  prometheusMetrics(namespace = 'subtrackr_jobs'): string {
    const snap = this.getDashboardSnapshot();
    const lines: string[] = [
      `# HELP ${namespace}_health Job system health (0=healthy, 1=degraded, 2=critical)`,
      `# TYPE ${namespace}_health gauge`,
      `${namespace}_health ${snap.health === 'healthy' ? 0 : snap.health === 'degraded' ? 1 : 2}`,

      `# HELP ${namespace}_queue_depth Current queue depth by priority`,
      `# TYPE ${namespace}_queue_depth gauge`,
      ...snap.queues.map((q) => `${namespace}_queue_depth{priority="${q.priority}"} ${q.depth}`),

      `# HELP ${namespace}_enqueued_total Total jobs enqueued by priority`,
      `# TYPE ${namespace}_enqueued_total counter`,
      ...snap.queues.map((q) => `${namespace}_enqueued_total{priority="${q.priority}"} ${q.totalEnqueued}`),

      `# HELP ${namespace}_processed_total Total jobs processed by priority`,
      `# TYPE ${namespace}_processed_total counter`,
      ...snap.queues.map((q) => `${namespace}_processed_total{priority="${q.priority}"} ${q.totalProcessed}`),

      `# HELP ${namespace}_slo_violations_total SLO violations by priority`,
      `# TYPE ${namespace}_slo_violations_total counter`,
      ...snap.queues.map((q) => `${namespace}_slo_violations_total{priority="${q.priority}"} ${q.sloViolations}`),

      `# HELP ${namespace}_avg_wait_ms Average job wait time by priority`,
      `# TYPE ${namespace}_avg_wait_ms gauge`,
      ...snap.queues.map((q) => `${namespace}_avg_wait_ms{priority="${q.priority}"} ${q.avgWaitMs.toFixed(2)}`),

      `# HELP ${namespace}_avg_processing_ms Average job processing time by priority`,
      `# TYPE ${namespace}_avg_processing_ms gauge`,
      ...snap.queues.map((q) => `${namespace}_avg_processing_ms{priority="${q.priority}"} ${q.avgProcessingMs.toFixed(2)}`),

      `# HELP ${namespace}_dlq_depth Dead letter queue depth by priority`,
      `# TYPE ${namespace}_dlq_depth gauge`,
      `${namespace}_dlq_depth{priority="critical"} ${snap.dlq.byCritical}`,
      `${namespace}_dlq_depth{priority="high"} ${snap.dlq.byHigh}`,
      `${namespace}_dlq_depth{priority="normal"} ${snap.dlq.byNormal}`,
      `${namespace}_dlq_depth{priority="low"} ${snap.dlq.byLow}`,

      `# HELP ${namespace}_rate_limit_throttled_total Rate-limited (throttled) job count by service`,
      `# TYPE ${namespace}_rate_limit_throttled_total counter`,
      ...snap.rateLimits.map(
        (r) => `${namespace}_rate_limit_throttled_total{service="${r.service}"} ${r.throttledCount}`,
      ),
    ];

    return lines.join('\n');
  }
}
