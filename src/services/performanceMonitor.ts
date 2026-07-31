import { Platform, InteractionManager } from 'react-native';
import performance from 'react-native-performance';

export type MetricType = 'render' | 'interaction' | 'network' | 'memory' | 'route' | 'bundle';

/** Core Web Vitals aligned metrics for React Native context */
export interface CoreWebVitals {
  /** Largest Contentful Paint equivalent – time from mount to last meaningful render (ms) */
  lcp?: number;
  /** First Input Delay equivalent – interaction handler scheduling latency (ms) */
  fid?: number;
  /** Cumulative Layout Shift equivalent – frame drops during render (count) */
  cls?: number;
}

export interface PerformanceMetric {
  type: MetricType;
  name: string;
  durationMs?: number;
  value?: number;
  unit?: 'ms' | 'bytes' | 'count' | 'percent' | 'fps';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface RouteTransitionMetric extends PerformanceMetric {
  type: 'route';
  fromRoute: string;
  toRoute: string;
  transitionMs: number;
}

export interface PerformanceSummary {
  totalMetrics: number;
  averages: Partial<Record<MetricType, number>>;
  p95: Partial<Record<MetricType, number>>;
  slowMetrics: PerformanceMetric[];
  regressions: PerformanceRegression[];
  coreWebVitals: CoreWebVitals;
  lastUpdatedAt?: number;
}

export interface PerformanceBudget {
  renderMs: number;
  apiLatencyMs: number;
  memoryBytes: number;
  routeTransitionMs: number;
  lcpMs: number;
  fidMs: number;
  clsFrameDrops: number;
  bundleSizeBytes: number;
}

export interface PerformanceRegression {
  metric: PerformanceMetric;
  budget: number;
  actual: number;
  exceedancePercent: number;
}

/** RUM (Real User Monitoring) session snapshot for remote reporting */
export interface RumSession {
  sessionId: string;
  platform: string;
  appVersion?: string;
  metrics: PerformanceMetric[];
  vitals: CoreWebVitals;
  summary: Pick<PerformanceSummary, 'averages' | 'p95' | 'regressions'>;
  capturedAt: number;
}

const DEFAULT_BUDGET: PerformanceBudget = {
  renderMs: 250,
  apiLatencyMs: 1200,
  memoryBytes: 250 * 1024 * 1024,
  routeTransitionMs: 300,
  lcpMs: 2500,
  fidMs: 100,
  clsFrameDrops: 5,
  bundleSizeBytes: 5 * 1024 * 1024, // 5 MB
};

const MAX_METRICS = 500;
const RUM_FLUSH_INTERVAL_MS = 30_000;

const nowHr = () => performance.now?.() ?? Date.now();

const getHeapSize = (): number | undefined => {
  const candidate = performance as typeof performance & {
    memory?: { usedJSHeapSize?: number };
  };
  return candidate.memory?.usedJSHeapSize;
};

const generateSessionId = (): string =>
  `rum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

class PerformanceMonitorService {
  private metrics: PerformanceMetric[] = [];
  private marks = new Map<string, number>();
  private budget: PerformanceBudget = DEFAULT_BUDGET;
  private listeners = new Set<(metrics: PerformanceMetric[]) => void>();
  private regressionListeners = new Set<(regression: PerformanceRegression) => void>();

  // Route transition tracking
  private currentRoute: string = 'unknown';
  private routeStartTime: number = nowHr();

  // Core Web Vitals tracking
  private vitals: CoreWebVitals = {};
  private frameDropCount = 0;
  private lastFrameTime: number = nowHr();

  // RUM session
  private sessionId: string = generateSessionId();
  private rumEndpoint: string | null = null;
  private rumFlushTimer: ReturnType<typeof setInterval> | null = null;

  // App startup timing
  private startupMark: number = nowHr();

  // ── Marks & Measures ──────────────────────────────────────────────────────

  mark(name: string): void {
    this.marks.set(name, nowHr());
    if (__DEV__) performance.mark?.(name);
  }

  measure(name: string, startMark: string, metadata?: Record<string, unknown>): number | undefined {
    const start = this.marks.get(startMark);
    if (start === undefined) return undefined;

    const durationMs = nowHr() - start;
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

  // ── Core Web Vitals ───────────────────────────────────────────────────────

  /**
   * Track Largest Contentful Paint (LCP) — call when the main content of a
   * screen has finished rendering.
   */
  trackLCP(screenName: string): void {
    const lcp = nowHr() - this.startupMark;
    this.vitals.lcp = this.vitals.lcp == null ? lcp : Math.max(this.vitals.lcp, lcp);

    this.track({
      type: 'render',
      name: `lcp:${screenName}`,
      durationMs: lcp,
      unit: 'ms',
      timestamp: Date.now(),
      metadata: { vital: 'LCP', screen: screenName },
    });

    if (lcp > this.budget.lcpMs) {
      this._emitRegression({
        metric: {
          type: 'render',
          name: `lcp:${screenName}`,
          durationMs: lcp,
          timestamp: Date.now(),
        },
        budget: this.budget.lcpMs,
        actual: lcp,
        exceedancePercent: ((lcp - this.budget.lcpMs) / this.budget.lcpMs) * 100,
      });
    }
  }

  /**
   * Track First Input Delay (FID) — call when measuring the delay from a user
   * interaction trigger to the start of the handler.
   */
  trackFID(interactionName: string, delayMs: number): void {
    this.vitals.fid = this.vitals.fid == null ? delayMs : Math.max(this.vitals.fid, delayMs);

    this.track({
      type: 'interaction',
      name: `fid:${interactionName}`,
      durationMs: delayMs,
      unit: 'ms',
      timestamp: Date.now(),
      metadata: { vital: 'FID', interaction: interactionName },
    });
  }

  /**
   * Track a frame drop (CLS equivalent) — call from animation or scroll
   * handlers when a frame is missed.
   */
  trackFrameDrop(context: string): void {
    this.frameDropCount += 1;
    this.vitals.cls = this.frameDropCount;

    this.track({
      type: 'render',
      name: `frame_drop:${context}`,
      value: this.frameDropCount,
      unit: 'count',
      timestamp: Date.now(),
      metadata: { vital: 'CLS_proxy', context },
    });
  }

  /** Reset frame drop counter at the start of a new interaction or animation. */
  resetFrameDrops(): void {
    this.frameDropCount = 0;
    this.vitals.cls = 0;
  }

  getCoreWebVitals(): CoreWebVitals {
    return { ...this.vitals };
  }

  // ── Route Transition Tracking ─────────────────────────────────────────────

  /**
   * Record that the app has navigated to a new route.  Call from the
   * NavigationContainer `onStateChange` handler.
   */
  trackRouteTransition(toRoute: string): void {
    const transitionMs = nowHr() - this.routeStartTime;
    const fromRoute = this.currentRoute;

    const metric: RouteTransitionMetric = {
      type: 'route',
      name: `route:${fromRoute}→${toRoute}`,
      fromRoute,
      toRoute,
      transitionMs,
      durationMs: transitionMs,
      unit: 'ms',
      timestamp: Date.now(),
      metadata: { from: fromRoute, to: toRoute },
    };

    this.track(metric);

    // Use InteractionManager to measure time until interactions are settled
    InteractionManager.runAfterInteractions(() => {
      const settleMs = nowHr() - this.routeStartTime;
      this.track({
        type: 'route',
        name: `route_settle:${toRoute}`,
        durationMs: settleMs,
        unit: 'ms',
        timestamp: Date.now(),
        metadata: { route: toRoute, phase: 'settled' },
      });
    });

    if (transitionMs > this.budget.routeTransitionMs) {
      this._emitRegression({
        metric,
        budget: this.budget.routeTransitionMs,
        actual: transitionMs,
        exceedancePercent:
          ((transitionMs - this.budget.routeTransitionMs) / this.budget.routeTransitionMs) * 100,
      });
    }

    this.currentRoute = toRoute;
    this.routeStartTime = nowHr();
    this.startupMark = nowHr();
  }

  getCurrentRoute(): string {
    return this.currentRoute;
  }

  // ── Bundle Size Tracking ──────────────────────────────────────────────────

  /** Record bundle size impact, typically called after a lazy import resolves. */
  trackBundleSize(moduleName: string, sizeBytes: number): void {
    this.track({
      type: 'bundle',
      name: `bundle:${moduleName}`,
      value: sizeBytes,
      unit: 'bytes',
      timestamp: Date.now(),
      metadata: { module: moduleName },
    });

    if (sizeBytes > this.budget.bundleSizeBytes) {
      this._emitRegression({
        metric: {
          type: 'bundle',
          name: `bundle:${moduleName}`,
          value: sizeBytes,
          timestamp: Date.now(),
        },
        budget: this.budget.bundleSizeBytes,
        actual: sizeBytes,
        exceedancePercent:
          ((sizeBytes - this.budget.bundleSizeBytes) / this.budget.bundleSizeBytes) * 100,
      });
    }
  }

  // ── General Tracking ──────────────────────────────────────────────────────

  track(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    if (this.metrics.length > MAX_METRICS) {
      this.metrics = this.metrics.slice(-MAX_METRICS);
    }

    // Emit regression alert synchronously when a budget is breached
    if (this.isRegression(metric)) {
      const budget = this._getBudgetFor(metric);
      if (budget != null) {
        const actual = metric.durationMs ?? metric.value ?? 0;
        this._emitRegression({
          metric,
          budget,
          actual,
          exceedancePercent: ((actual - budget) / budget) * 100,
        });
      }
    }

    this.listeners.forEach((listener) => listener(this.getRecentMetrics(MAX_METRICS)));
  }

  async trackApiCall<T>(
    name: string,
    request: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = nowHr();
    try {
      return await request();
    } finally {
      this.track({
        type: 'network',
        name,
        durationMs: nowHr() - start,
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

  // ── Budget Management ─────────────────────────────────────────────────────

  configureBudget(budget: Partial<PerformanceBudget>): void {
    this.budget = { ...this.budget, ...budget };
  }

  getBudget(): PerformanceBudget {
    return { ...this.budget };
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getRecentMetrics(limit = 50): PerformanceMetric[] {
    return this.metrics.slice(-limit);
  }

  getSummary(): PerformanceSummary {
    const averages: PerformanceSummary['averages'] = {};
    const p95: PerformanceSummary['p95'] = {};

    const types: MetricType[] = ['render', 'interaction', 'network', 'memory', 'route', 'bundle'];
    for (const type of types) {
      const values = this.metrics
        .filter((metric) => metric.type === type)
        .map((metric) => metric.durationMs ?? metric.value)
        .filter((value): value is number => typeof value === 'number')
        .sort((a, b) => a - b);

      if (!values.length) continue;

      averages[type] = values.reduce((sum, value) => sum + value, 0) / values.length;
      p95[type] = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
    }

    const regressions = this.metrics
      .filter((m) => this.isRegression(m))
      .map((m) => {
        const budget = this._getBudgetFor(m) ?? 0;
        const actual = m.durationMs ?? m.value ?? 0;
        return {
          metric: m,
          budget,
          actual,
          exceedancePercent: budget > 0 ? ((actual - budget) / budget) * 100 : 0,
        };
      })
      .slice(-25);

    return {
      totalMetrics: this.metrics.length,
      averages,
      p95,
      slowMetrics: regressions.map((r) => r.metric),
      regressions,
      coreWebVitals: this.getCoreWebVitals(),
      lastUpdatedAt: this.metrics[this.metrics.length - 1]?.timestamp,
    };
  }

  isRegression(metric: PerformanceMetric): boolean {
    const val = metric.durationMs ?? metric.value ?? 0;
    if (metric.type === 'render') return val > this.budget.renderMs;
    if (metric.type === 'network') return val > this.budget.apiLatencyMs;
    if (metric.type === 'memory') return val > this.budget.memoryBytes;
    if (metric.type === 'route') return val > this.budget.routeTransitionMs;
    if (metric.type === 'bundle') return val > this.budget.bundleSizeBytes;
    return false;
  }

  // ── Real User Monitoring ──────────────────────────────────────────────────

  /**
   * Configure a RUM endpoint. When set, the monitor will periodically POST
   * session snapshots to the endpoint for real-user monitoring dashboards.
   *
   * The endpoint receives a JSON body matching `RumSession`.
   */
  configureRum(endpoint: string): void {
    this.rumEndpoint = endpoint;
    this._scheduleRumFlush();
  }

  /** Build a RUM session snapshot without sending it. */
  buildRumSession(): RumSession {
    const summary = this.getSummary();
    return {
      sessionId: this.sessionId,
      platform: Platform.OS,
      appVersion: undefined, // populated if expo-application is available
      metrics: this.getRecentMetrics(100),
      vitals: this.getCoreWebVitals(),
      summary: {
        averages: summary.averages,
        p95: summary.p95,
        regressions: summary.regressions,
      },
      capturedAt: Date.now(),
    };
  }

  /** Force-flush the RUM session to the configured endpoint. */
  async flushRumSession(): Promise<void> {
    if (!this.rumEndpoint) return;
    const session = this.buildRumSession();
    try {
      await fetch(this.rumEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });
    } catch {
      // Swallow network errors — RUM is best-effort
    }
  }

  // ── Regression Alerts ─────────────────────────────────────────────────────

  /** Subscribe to regression events as they happen. */
  onRegression(listener: (regression: PerformanceRegression) => void): () => void {
    this.regressionListeners.add(listener);
    return () => this.regressionListeners.delete(listener);
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  subscribe(listener: (metrics: PerformanceMetric[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getRecentMetrics(MAX_METRICS));
    return () => this.listeners.delete(listener);
  }

  reset(): void {
    this.metrics = [];
    this.marks.clear();
    this.vitals = {};
    this.frameDropCount = 0;
    this.sessionId = generateSessionId();
    this.listeners.forEach((listener) => listener([]));
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private _getBudgetFor(metric: PerformanceMetric): number | null {
    if (metric.type === 'render') return this.budget.renderMs;
    if (metric.type === 'network') return this.budget.apiLatencyMs;
    if (metric.type === 'memory') return this.budget.memoryBytes;
    if (metric.type === 'route') return this.budget.routeTransitionMs;
    if (metric.type === 'bundle') return this.budget.bundleSizeBytes;
    return null;
  }

  private _emitRegression(regression: PerformanceRegression): void {
    this.regressionListeners.forEach((listener) => listener(regression));
    if (__DEV__) {
      console.warn(
        `[Perf] Regression: ${regression.metric.name} — ` +
          `${regression.actual.toFixed(1)} exceeds budget ${regression.budget} ` +
          `(+${regression.exceedancePercent.toFixed(1)}%)`
      );
    }
  }

  private _scheduleRumFlush(): void {
    if (this.rumFlushTimer) clearInterval(this.rumFlushTimer);
    this.rumFlushTimer = setInterval(() => {
      void this.flushRumSession();
    }, RUM_FLUSH_INTERVAL_MS);
  }
}

export const performanceMonitor = new PerformanceMonitorService();
