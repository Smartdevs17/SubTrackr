type MetricType = 'render' | 'interaction' | 'network';

interface PerformanceMetric {
  type: MetricType;
  name: string;
  durationMs: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const SLOW_FRAME_BUDGET_MS = 16.67;

class PerformanceMonitorService {
  private metrics: PerformanceMetric[] = [];

  track(metric: PerformanceMetric) {
    this.metrics.push(metric);

    // Keep memory bounded for long-running sessions.
    if (this.metrics.length > 500) {
      this.metrics = this.metrics.slice(-500);
    }

    if (__DEV__) {
      const budgetNote = metric.durationMs > SLOW_FRAME_BUDGET_MS ? ' (over 60fps budget)' : '';
      console.debug(
        `[perf] ${metric.type}:${metric.name} ${metric.durationMs.toFixed(2)}ms${budgetNote}`
      );
    }
  }

  getRecentMetrics(limit = 50): PerformanceMetric[] {
    return this.metrics.slice(-limit);
  }
}

export const performanceMonitor = new PerformanceMonitorService();
