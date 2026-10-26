/**
 * Job Queue Prometheus Exporter
 *
 * Exposes per-priority queue depth, wait time, processing time,
 * and SLO violation metrics for Prometheus scraping.
 */

import type { PriorityClass, PriorityStatsMap } from '../shared/queue';
import { LATENCY_SLO_MS, PRIORITY_ORDER } from '../shared/queue';

export interface QueueMetricsSnapshot {
  stats: PriorityStatsMap;
  schedulerPaused: PriorityClass[];
}

export function collectQueueMetrics(
  stats: PriorityStatsMap,
  schedulerPaused: PriorityClass[] = [],
): QueueMetricsSnapshot {
  return { stats, schedulerPaused };
}

function avgWaitMs(stat: PriorityStatsMap[PriorityClass]): number {
  return stat.totalProcessed > 0 ? stat.totalWaitTimeMs / stat.totalProcessed : 0;
}

function avgProcessingMs(stat: PriorityStatsMap[PriorityClass]): number {
  return stat.totalProcessed > 0 ? stat.totalProcessingTimeMs / stat.totalProcessed : 0;
}

/**
 * Render Prometheus text format for queue monitoring.
 *
 * Metrics:
 *   subtrackr_queue_depth{priority="..."}
 *   subtrackr_queue_paused{priority="..."}
 *   subtrackr_queue_enqueued_total{priority="..."}
 *   subtrackr_queue_processed_total{priority="..."}
 *   subtrackr_queue_wait_time_ms{priority="..."}
 *   subtrackr_queue_processing_time_ms{priority="..."}
 *   subtrackr_queue_avg_wait_time_ms{priority="..."}
 *   subtrackr_queue_avg_processing_time_ms{priority="..."}
 *   subtrackr_queue_slo_violations_total{priority="..."}
 *   subtrackr_queue_slo_threshold_ms{priority="..."}
 */
export function formatQueuePrometheus(snapshot: QueueMetricsSnapshot): string {
  const lines: string[] = [];
  const { stats } = snapshot;

  lines.push('# HELP subtrackr_queue_depth Current number of jobs waiting per priority class');
  lines.push('# TYPE subtrackr_queue_depth gauge');
  for (const p of PRIORITY_ORDER) {
    lines.push(`subtrackr_queue_depth{priority="${p}"} ${stats[p].depth}`);
  }

  lines.push('# HELP subtrackr_queue_paused Whether the priority queue is paused (1=yes, 0=no)');
  lines.push('# TYPE subtrackr_queue_paused gauge');
  for (const p of PRIORITY_ORDER) {
    const paused = stats[p].paused || snapshot.schedulerPaused.includes(p) ? 1 : 0;
    lines.push(`subtrackr_queue_paused{priority="${p}"} ${paused}`);
  }

  lines.push('# HELP subtrackr_queue_enqueued_total Total jobs enqueued per priority class');
  lines.push('# TYPE subtrackr_queue_enqueued_total counter');
  for (const p of PRIORITY_ORDER) {
    lines.push(`subtrackr_queue_enqueued_total{priority="${p}"} ${stats[p].totalEnqueued}`);
  }

  lines.push('# HELP subtrackr_queue_processed_total Total jobs processed per priority class');
  lines.push('# TYPE subtrackr_queue_processed_total counter');
  for (const p of PRIORITY_ORDER) {
    lines.push(`subtrackr_queue_processed_total{priority="${p}"} ${stats[p].totalProcessed}`);
  }

  lines.push('# HELP subtrackr_queue_wait_time_ms Last job wait time in milliseconds');
  lines.push('# TYPE subtrackr_queue_wait_time_ms gauge');
  for (const p of PRIORITY_ORDER) {
    lines.push(`subtrackr_queue_wait_time_ms{priority="${p}"} ${Math.round(stats[p].lastWaitTimeMs)}`);
  }

  lines.push('# HELP subtrackr_queue_processing_time_ms Last job processing time in milliseconds');
  lines.push('# TYPE subtrackr_queue_processing_time_ms gauge');
  for (const p of PRIORITY_ORDER) {
    lines.push(
      `subtrackr_queue_processing_time_ms{priority="${p}"} ${Math.round(stats[p].lastProcessingTimeMs)}`,
    );
  }

  lines.push('# HELP subtrackr_queue_avg_wait_time_ms Average wait time per priority class');
  lines.push('# TYPE subtrackr_queue_avg_wait_time_ms gauge');
  for (const p of PRIORITY_ORDER) {
    lines.push(`subtrackr_queue_avg_wait_time_ms{priority="${p}"} ${Math.round(avgWaitMs(stats[p]))}`);
  }

  lines.push('# HELP subtrackr_queue_avg_processing_time_ms Average processing time per priority class');
  lines.push('# TYPE subtrackr_queue_avg_processing_time_ms gauge');
  for (const p of PRIORITY_ORDER) {
    lines.push(
      `subtrackr_queue_avg_processing_time_ms{priority="${p}"} ${Math.round(avgProcessingMs(stats[p]))}`,
    );
  }

  lines.push('# HELP subtrackr_queue_slo_violations_total Jobs exceeding latency SLO per priority');
  lines.push('# TYPE subtrackr_queue_slo_violations_total counter');
  for (const p of PRIORITY_ORDER) {
    lines.push(`subtrackr_queue_slo_violations_total{priority="${p}"} ${stats[p].sloViolations}`);
  }

  lines.push('# HELP subtrackr_queue_slo_threshold_ms Latency SLO threshold in milliseconds');
  lines.push('# TYPE subtrackr_queue_slo_threshold_ms gauge');
  for (const p of PRIORITY_ORDER) {
    const threshold = Number.isFinite(LATENCY_SLO_MS[p]) ? LATENCY_SLO_MS[p] : -1;
    lines.push(`subtrackr_queue_slo_threshold_ms{priority="${p}"} ${threshold}`);
  }

  return lines.join('\n');
}

export function createQueueMetricsHandler(getSnapshot: () => QueueMetricsSnapshot) {
  return function handleQueueMetrics(
    _req: unknown,
    res: { setHeader(name: string, value: string): void; end(body: string): void },
  ): void {
    const body = formatQueuePrometheus(getSnapshot());
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(body);
  };
}
