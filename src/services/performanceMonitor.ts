import { Platform } from 'react-native';
import performance from 'react-native-performance';

export type MetricType = 'render' | 'interaction' | 'network' | 'memory';

export interface PerformanceMetric {
  type: MetricType;
  name: string;
  durationMs?: number;
  value?: number;
  unit?: 'ms' | 'bytes' | 'count' | 'percent';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface PerformanceSummary {
  totalMetrics: number;
  averages: Partial<Record<MetricType, number>>;
  p95: Partial<Record<MetricType, number>>;
  slowMetrics: PerformanceMetric[];
  lastUpdatedAt?: number;
}

export interface PerformanceBudget {
  renderMs: number;
  apiLatencyMs: number;
  memoryBytes: number;
}

const DEFAULT_BUDGET: PerformanceBudget = {
  renderMs: 250,
  apiLatencyMs: 1200,
  memoryBytes: 250 * 1024 * 1024,
};

const MAX_METRICS = 500;

const now = () => performance.now?.() ?? Date.now();

const getHeapSize = (): number | undefined => {
  const candidate = performance as typeof performance & {
    memory?: { usedJSHeapSize?: number };
  };
  return candidate.memory?.usedJSHeapSize;
};

class PerformanceMonitorService {
  private metrics: PerformanceMetric[] = [];
  private marks = new Map<string, number>();
  private budget: PerformanceBudget = DEFAULT_BUDGET;
  private listeners = new Set<(metrics: PerformanceMetric[]) => void>();

  mark(name: string): void {
    this.marks.set(name, now());
    if (__DEV__) performance.mark?.(name);
  }

  measure(name: string, startMark: string, metadata?: Record<string, unknown>): number | undefined {
    const start = this.marks.get(startMark);
    if (start === undefined) return undefined;

    const durationMs = now() - start;
    this.track({
      type: 'interaction',
      name,
      durationMs,
      timestamp: Date.now(),
      metadata,
    });

    if (__DEV__) {
      const endMark = `${startMark}:end`;
      performance.mark?.(endMark);
      performance.measure?.(name, startMark, endMark);
    }

    this.marks.delete(startMark);
    return durationMs;
  }

  track(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    if (this.metrics.length > MAX_METRICS) {
      this.metrics = this.metrics.slice(-MAX_METRICS);
    }

    this.listeners.forEach((listener) => listener(this.getRecentMetrics(MAX_METRICS)));
  }

  async trackApiCall<T>(
    name: string,
    request: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = now();
    try {
      return await request();
    } finally {
      this.track({
        type: 'network',
        name,
        durationMs: now() - start,
        timestamp: Date.now(),
        metadata,
      });
    }
  }

  trackMemoryUsage(name = 'runtime', value?: number): void {
    const memoryValue = value ?? (typeof getHeapSize() === 'number' ? getHeapSize() : undefined);

    if (typeof memoryValue !== 'number') return;

    this.track({
      type: 'memory',
      name,
      value: memoryValue,
      unit: 'bytes',
      timestamp: Date.now(),
      metadata: { platform: Platform.OS },
    });
  }

  configureBudget(budget: Partial<PerformanceBudget>): void {
    this.budget = { ...this.budget, ...budget };
  }

  getBudget(): PerformanceBudget {
    return { ...this.budget };
  }

  getRecentMetrics(limit = 50): PerformanceMetric[] {
    return this.metrics.slice(-limit);
  }

  getSummary(): PerformanceSummary {
    const averages: PerformanceSummary['averages'] = {};
    const p95: PerformanceSummary['p95'] = {};

    for (const type of ['render', 'interaction', 'network', 'memory'] as MetricType[]) {
      const values = this.metrics
        .filter((metric) => metric.type === type)
        .map((metric) => metric.durationMs ?? metric.value)
        .filter((value): value is number => typeof value === 'number')
        .sort((a, b) => a - b);

      if (!values.length) continue;

      averages[type] = values.reduce((sum, value) => sum + value, 0) / values.length;
      p95[type] = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
    }

    return {
      totalMetrics: this.metrics.length,
      averages,
      p95,
      slowMetrics: this.metrics.filter((metric) => this.isRegression(metric)).slice(-25),
      lastUpdatedAt: this.metrics[this.metrics.length - 1]?.timestamp,
    };
  }

  isRegression(metric: PerformanceMetric): boolean {
    if (metric.type === 'render') return (metric.durationMs ?? 0) > this.budget.renderMs;
    if (metric.type === 'network') return (metric.durationMs ?? 0) > this.budget.apiLatencyMs;
    if (metric.type === 'memory') return (metric.value ?? 0) > this.budget.memoryBytes;
    return false;
  }

  subscribe(listener: (metrics: PerformanceMetric[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getRecentMetrics(MAX_METRICS));
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.metrics = [];
    this.marks.clear();
    this.listeners.forEach((listener) => listener([]));
  }
}

export const performanceMonitor = new PerformanceMonitorService();
