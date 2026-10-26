/**
 * Rule Statistics Aggregation Cron Job
 *
 * Periodically aggregates per-rule statistics (hit rate, false positive rate,
 * average score) and exposes them for dashboard consumption.
 *
 * Designed to run on a configurable interval inside a Node.js process.
 * In a Kubernetes/serverless environment replace the setInterval with your
 * scheduler of choice (e.g., pg_cron, AWS EventBridge, BullMQ).
 */

import { defaultEngine } from '../domain/RuleEngine';
import { RuleStats } from '../domain/RuleRegistry';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AggregatedRuleReport {
  generatedAt: string;
  rules: RuleStats[];
  totalEvaluations: number;
  totalHits: number;
  overallHitRate: number;
  topRuleByHitCount: string | null;
  topRuleByAvgScore: string | null;
}

// ── Aggregator ────────────────────────────────────────────────────────────────

export class RuleStatisticsAggregator {
  private latestReport: AggregatedRuleReport | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private intervalMs: number;

  constructor(intervalMs = 60_000) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.intervalHandle) return;
    this.aggregate(); // run immediately
    this.intervalHandle = setInterval(() => this.aggregate(), this.intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getLatestReport(): AggregatedRuleReport | null {
    return this.latestReport;
  }

  aggregate(): AggregatedRuleReport {
    const stats = defaultEngine.getStats();

    const totalEvaluations = stats.reduce((s, r) => s + r.evaluationCount, 0);
    const totalHits = stats.reduce((s, r) => s + r.hitCount, 0);
    const overallHitRate = totalEvaluations > 0 ? totalHits / totalEvaluations : 0;

    const sorted = [...stats].sort((a, b) => b.hitCount - a.hitCount);
    const topByHit = sorted[0]?.name ?? null;
    const topByAvg = [...stats].sort((a, b) => b.avgScore - a.avgScore)[0]?.name ?? null;

    const report: AggregatedRuleReport = {
      generatedAt: new Date().toISOString(),
      rules: stats,
      totalEvaluations,
      totalHits,
      overallHitRate,
      topRuleByHitCount: topByHit,
      topRuleByAvgScore: topByAvg,
    };

    this.latestReport = report;
    return report;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const ruleStatisticsAggregator = new RuleStatisticsAggregator();
