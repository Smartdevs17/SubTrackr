/**
 * Cohort Aggregation Job
 *
 * Nightly job that pre-computes cohort tables (week + month granularity) for
 * every merchant in the subscriber record repository, so the analytics
 * dashboard and REST endpoints can serve cached results instead of
 * recomputing on every request. Mirrors the start/stop + metrics shape used
 * by backend/analytics/jobs/mvRefreshJob.ts.
 */

import { CohortService } from '../../services/analytics/cohortService';
import { SubscriberRecordRepository, subscriberRecordRepository } from '../../services/analytics/subscriberRecordRepository';
import type { CohortBucket } from '../../../src/types/cohortAnalytics';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000; // nightly

export interface CohortAggregationMetrics {
  runs: number;
  merchantsProcessed: number;
  lastRunAt: number | null;
  lastRunDurationMs: number | null;
  lastError: string | null;
}

export class CohortAggregationJob {
  private readonly repository: SubscriberRecordRepository;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private cache = new Map<string, { week: CohortBucket[]; month: CohortBucket[]; computedAt: number }>();
  private metrics: CohortAggregationMetrics = {
    runs: 0,
    merchantsProcessed: 0,
    lastRunAt: null,
    lastRunDurationMs: null,
    lastError: null,
  };

  constructor(repository: SubscriberRecordRepository = subscriberRecordRepository, intervalMs = DEFAULT_INTERVAL_MS) {
    this.repository = repository;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.timer) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), this.intervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    const startedAt = Date.now();
    try {
      const merchants = this.repository.listMerchants();
      for (const merchantId of merchants) {
        const records = this.repository.getByMerchant(merchantId);
        this.cache.set(merchantId, {
          week: CohortService.buildCohortTable(records, 'week'),
          month: CohortService.buildCohortTable(records, 'month'),
          computedAt: Date.now(),
        });
      }
      this.metrics.runs += 1;
      this.metrics.merchantsProcessed = merchants.length;
      this.metrics.lastRunAt = Date.now();
      this.metrics.lastRunDurationMs = Date.now() - startedAt;
      this.metrics.lastError = null;
    } catch (error) {
      this.metrics.lastError = error instanceof Error ? error.message : 'Cohort aggregation run failed';
    } finally {
      this.isRunning = false;
    }
  }

  getCachedCohorts(merchantId: string, granularity: 'week' | 'month'): CohortBucket[] | null {
    const cached = this.cache.get(merchantId);
    if (!cached) return null;
    return cached[granularity];
  }

  getMetrics(): CohortAggregationMetrics {
    return { ...this.metrics };
  }
}

export const cohortAggregationJob = new CohortAggregationJob();
