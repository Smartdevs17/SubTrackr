import { createEmptyStats } from '../../shared/queue';
import { collectQueueMetrics, formatQueuePrometheus } from '../queueMetricsExporter';

describe('queueMetricsExporter', () => {
  it('formats per-priority depth, wait, and processing metrics', () => {
    const stats = createEmptyStats();
    stats.critical.depth = 3;
    stats.critical.totalEnqueued = 10;
    stats.critical.totalProcessed = 8;
    stats.critical.totalWaitTimeMs = 80_000;
    stats.critical.totalProcessingTimeMs = 4_000;
    stats.critical.lastWaitTimeMs = 12_000;
    stats.critical.lastProcessingTimeMs = 500;
    stats.critical.sloViolations = 1;

    stats.low.depth = 50;
    stats.low.totalEnqueued = 200;
    stats.low.paused = true;

    const output = formatQueuePrometheus(
      collectQueueMetrics(stats, ['low']),
    );

    expect(output).toContain('subtrackr_queue_depth{priority="critical"} 3');
    expect(output).toContain('subtrackr_queue_depth{priority="low"} 50');
    expect(output).toContain('subtrackr_queue_enqueued_total{priority="critical"} 10');
    expect(output).toContain('subtrackr_queue_processed_total{priority="critical"} 8');
    expect(output).toContain('subtrackr_queue_wait_time_ms{priority="critical"} 12000');
    expect(output).toContain('subtrackr_queue_avg_wait_time_ms{priority="critical"} 10000');
    expect(output).toContain('subtrackr_queue_slo_violations_total{priority="critical"} 1');
    expect(output).toContain('subtrackr_queue_slo_threshold_ms{priority="critical"} 30000');
    expect(output).toContain('subtrackr_queue_slo_threshold_ms{priority="high"} 120000');
    expect(output).toContain('subtrackr_queue_slo_threshold_ms{priority="normal"} 600000');
    expect(output).toContain('subtrackr_queue_paused{priority="low"} 1');
  });

  it('reports zero averages when no jobs processed', () => {
    const stats = createEmptyStats();
    const output = formatQueuePrometheus(collectQueueMetrics(stats));

    expect(output).toContain('subtrackr_queue_avg_wait_time_ms{priority="high"} 0');
    expect(output).toContain('subtrackr_queue_avg_processing_time_ms{priority="normal"} 0');
  });

  it('uses -1 for low priority SLO threshold (no SLO)', () => {
    const stats = createEmptyStats();
    const output = formatQueuePrometheus(collectQueueMetrics(stats));
    expect(output).toContain('subtrackr_queue_slo_threshold_ms{priority="low"} -1');
  });
});
