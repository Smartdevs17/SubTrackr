import { Platform, AppState, AppStateStatus, InteractionManager } from 'react-native';
import performance from 'react-native-performance';

export type MetricType =
  | 'render'
  | 'interaction'
  | 'network'
  | 'memory'
  | 'route'
  | 'bundle'
  | 'tti'
  | 'inp'
  | 'cls';

// ── Core Web Vitals ───────────────────────────────────────────────────────────

/** Core Web Vitals aligned metrics for React Native context */
export interface CoreWebVitals {
  /** Largest Contentful Paint equivalent – time from mount to last meaningful render (ms) */
  lcp?: number;
  /** First Input Delay equivalent – interaction handler scheduling latency (ms) */
  fid?: number;
  /** Cumulative Layout Shift equivalent – weighted layout shift score (0–∞, lower is better) */
  cls?: number;
  /** Time to Interactive – time until the JS thread is consistently idle (ms) */
  tti?: number;
  /** Interaction to Next Paint – max observed interaction latency in the session (ms) */
  inp?: number;
}

/** Rating thresholds aligned with web.dev CWV guidelines, adapted for React Native */
export type VitalRating = 'good' | 'needs-improvement' | 'poor';

export interface VitalWithRating {
  value: number;
  rating: VitalRating;
}

export interface CoreWebVitalsRated {
  lcp?: VitalWithRating;
  fid?: VitalWithRating;
  cls?: VitalWithRating;
  tti?: VitalWithRating;
  inp?: VitalWithRating;
}

// ── Per-screen vitals breakdown ───────────────────────────────────────────────

export interface ScreenVitals {
  screen: string;
  lcp?: number;
  fid?: number;
  cls?: number;
  tti?: number;
  inp?: number;
  /** When the screen first rendered */
  firstRenderedAt: number;
  /** Number of times the screen has been visited */
  visitCount: number;
}

// ── Layout shift tracking ─────────────────────────────────────────────────────

export interface LayoutShiftEntry {
  context: string;
  score: number;
  timestamp: number;
}

// ── CLS session window (5-second windows, 1-second gap) ──────────────────────

interface ClsWindow {
  startTime: number;
  lastTime: number;
  score: number;
}

// ── Vitals history entry ──────────────────────────────────────────────────────

export interface VitalsSnapshot {
  sessionId: string;
  route: string;
  vitals: CoreWebVitals;
  ratedVitals: CoreWebVitalsRated;
  capturedAt: number;
}

// ── General metrics ───────────────────────────────────────────────────────────

export interface PerformanceMetric {
  type: MetricType;
  name: string;
  durationMs?: number;
  value?: number;
  unit?: 'ms' | 'bytes' | 'count' | 'percent' | 'fps' | 'score';
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
  ratedVitals: CoreWebVitalsRated;
  screenVitals: ScreenVitals[];
  lastUpdatedAt?: number;
}

export interface PerformanceBudget {
  renderMs: number;
  apiLatencyMs: number;
  memoryBytes: number;
  routeTransitionMs: number;
  lcpMs: number;
  fidMs: number;
  /** CLS score budget (not frame count) — 0.1 is "good", 0.25 is "needs improvement" */
  clsScore: number;
  bundleSizeBytes: number;
  ttiMs: number;
  inpMs: number;
  /** Legacy alias kept for backward compat */
  clsFrameDrops: number;
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
  ratedVitals: CoreWebVitalsRated;
  screenVitals: ScreenVitals[];
  vitalsHistory: VitalsSnapshot[];
  summary: Pick<PerformanceSummary, 'averages' | 'p95' | 'regressions'>;
  appStateChanges: AppStateChangeRecord[];
  capturedAt: number;
}

// ── App state monitoring ──────────────────────────────────────────────────────

export interface AppStateChangeRecord {
  from: AppStateStatus;
  to: AppStateStatus;
  at: number;
  /** How long (ms) the app spent in the previous state */
  durationMs: number;
}

// ── TTI measurement ───────────────────────────────────────────────────────────

/** Internal state machine for TTI (Time to Interactive) measurement */
interface TtiState {
  startTime: number;
  quietPeriodStart: number | null;
  /** Minimum quiet period (no tasks > 50 ms) required to declare TTI */
  quietWindowMs: number;
  resolved: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BUDGET: PerformanceBudget = {
  renderMs: 250,
  apiLatencyMs: 1200,
  memoryBytes: 250 * 1024 * 1024,
  routeTransitionMs: 300,
  lcpMs: 2500,
  fidMs: 100,
  clsScore: 0.1,
  clsFrameDrops: 5,   // legacy compat
  bundleSizeBytes: 5 * 1024 * 1024,
  ttiMs: 3800,
  inpMs: 200,
};

/** CLS 5-second session window constants (mirrors web spec) */
const CLS_SESSION_GAP_MS = 1_000;
const CLS_SESSION_MAX_MS = 5_000;

const MAX_METRICS = 500;
const MAX_VITALS_HISTORY = 100;
const MAX_APP_STATE_RECORDS = 50;
const RUM_FLUSH_INTERVAL_MS = 30_000;

/** Quiet-window length for TTI: 5 s with no long task (>50 ms) — mirrors Lighthouse */
const TTI_QUIET_WINDOW_MS = 5_000;
/** Long-task threshold that resets the TTI quiet window */
const LONG_TASK_THRESHOLD_MS = 50;

const nowHr = () => performance.now?.() ?? Date.now();

const getHeapSize = (): number | undefined => {
  const candidate = performance as typeof performance & {
    memory?: { usedJSHeapSize?: number };
  };
  return candidate.memory?.usedJSHeapSize;
};

const generateSessionId = (): string =>
  `rum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ── CWV rating helpers ────────────────────────────────────────────────────────

function rateLcp(ms: number): VitalRating {
  if (ms <= 2500) return 'good';
  if (ms <= 4000) return 'needs-improvement';
  return 'poor';
}

function rateFid(ms: number): VitalRating {
  if (ms <= 100) return 'good';
  if (ms <= 300) return 'needs-improvement';
  return 'poor';
}

function rateCls(score: number): VitalRating {
  if (score <= 0.1) return 'good';
  if (score <= 0.25) return 'needs-improvement';
  return 'poor';
}

function rateTti(ms: number): VitalRating {
  if (ms <= 3800) return 'good';
  if (ms <= 7300) return 'needs-improvement';
  return 'poor';
}

function rateInp(ms: number): VitalRating {
  if (ms <= 200) return 'good';
  if (ms <= 500) return 'needs-improvement';
  return 'poor';
}

function rateVitals(vitals: CoreWebVitals): CoreWebVitalsRated {
  const rated: CoreWebVitalsRated = {};
  if (vitals.lcp != null) rated.lcp = { value: vitals.lcp, rating: rateLcp(vitals.lcp) };
  if (vitals.fid != null) rated.fid = { value: vitals.fid, rating: rateFid(vitals.fid) };
  if (vitals.cls != null) rated.cls = { value: vitals.cls, rating: rateCls(vitals.cls) };
  if (vitals.tti != null) rated.tti = { value: vitals.tti, rating: rateTti(vitals.tti) };
  if (vitals.inp != null) rated.inp = { value: vitals.inp, rating: rateInp(vitals.inp) };
  return rated;
}

// ─────────────────────────────────────────────────────────────────────────────
// PerformanceMonitorService
// ─────────────────────────────────────────────────────────────────────────────

class PerformanceMonitorService {
  private metrics: PerformanceMetric[] = [];
  private marks = new Map<string, number>();
  private budget: PerformanceBudget = DEFAULT_BUDGET;
  private listeners = new Set<(metrics: PerformanceMetric[]) => void>();
  private regressionListeners = new Set<(regression: PerformanceRegression) => void>();

  // Route transition tracking
  private currentRoute: string = 'unknown';
  private routeStartTime: number = nowHr();

  // Core Web Vitals
  private vitals: CoreWebVitals = {};

  // CLS — per-session-window accumulation (mirrors the web spec)
  private clsWindows: ClsWindow[] = [];
  private layoutShiftEntries: LayoutShiftEntry[] = [];

  // TTI state machine
  private ttiState: TtiState = {
    startTime: nowHr(),
    quietPeriodStart: null,
    quietWindowMs: TTI_QUIET_WINDOW_MS,
    resolved: false,
  };

  // INP — tracks max interaction latency in session
  private inpSamples: number[] = [];

  // Per-screen vitals
  private screenVitalsMap = new Map<string, ScreenVitals>();

  // Vitals history (ring-buffer of snapshots)
  private vitalsHistory: VitalsSnapshot[] = [];

  // App state monitoring
  private appStateRecords: AppStateChangeRecord[] = [];
  private lastAppState: AppStateStatus = AppState.currentState;
  private lastAppStateChangeAt: number = Date.now();
  private appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

  // RUM session
  private sessionId: string = generateSessionId();
  private rumEndpoint: string | null = null;
  private rumFlushTimer: ReturnType<typeof setInterval> | null = null;

  // App startup timing
  private startupMark: number = nowHr();

  constructor() {
    this._initAppStateMonitor();
  }

  // ── App state monitoring ──────────────────────────────────────────────────

  private _initAppStateMonitor(): void {
    this.appStateSubscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        const now = Date.now();
        const record: AppStateChangeRecord = {
          from: this.lastAppState,
          to: nextState,
          at: now,
          durationMs: now - this.lastAppStateChangeAt,
        };
        this.appStateRecords.push(record);
        if (this.appStateRecords.length > MAX_APP_STATE_RECORDS) {
          this.appStateRecords = this.appStateRecords.slice(-MAX_APP_STATE_RECORDS);
        }

        // Resume TTI tracking when app comes to foreground
        if (nextState === 'active' && this.lastAppState !== 'active') {
          this.ttiState = {
            startTime: nowHr(),
            quietPeriodStart: null,
            quietWindowMs: TTI_QUIET_WINDOW_MS,
            resolved: false,
          };
        }

        this.lastAppState = nextState;
        this.lastAppStateChangeAt = now;
      }
    );
  }

  // ── Marks & Measures ──────────────────────────────────────────────────────

  mark(name: string): void {
    this.marks.set(name, nowHr());
    if (__DEV__) performance.mark?.(name);
  }

  measure(name: string, startMark: string, metadata?: Record<string, unknown>): number | undefined {
    const start = this.marks.get(startMark);
    if (start === undefined) return undefined;

    const durationMs = nowHr() - start;

    // Long-task detection: reset TTI quiet window if task exceeds threshold
    if (durationMs >= LONG_TASK_THRESHOLD_MS) {
      this._onLongTask();
    }

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
   * Track Largest Contentful Paint (LCP).
   * Call when the main content of a screen has finished rendering.
   */
  trackLCP(screenName: string): void {
    const lcp = nowHr() - this.startupMark;
    this.vitals.lcp = this.vitals.lcp == null ? lcp : Math.max(this.vitals.lcp, lcp);

    // Per-screen breakdown
    this._updateScreenVital(screenName, 'lcp', lcp);

    this.track({
      type: 'render',
      name: `lcp:${screenName}`,
      durationMs: lcp,
      unit: 'ms',
      timestamp: Date.now(),
      metadata: { vital: 'LCP', screen: screenName, rating: rateLcp(lcp) },
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
   * Track First Input Delay (FID).
   * Call when measuring the delay from a user interaction trigger to the handler start.
   */
  trackFID(interactionName: string, delayMs: number): void {
    this.vitals.fid = this.vitals.fid == null ? delayMs : Math.max(this.vitals.fid, delayMs);

    // Per-screen
    this._updateScreenVital(this.currentRoute, 'fid', delayMs);

    this.track({
      type: 'interaction',
      name: `fid:${interactionName}`,
      durationMs: delayMs,
      unit: 'ms',
      timestamp: Date.now(),
      metadata: { vital: 'FID', interaction: interactionName, rating: rateFid(delayMs) },
    });
  }

  /**
   * Track Interaction to Next Paint (INP).
   * Call after each user interaction completes its visual response.
   * INP is the 98th-percentile (or max for small samples) interaction latency.
   */
  trackINP(interactionName: string, durationMs: number): void {
    this.inpSamples.push(durationMs);

    // INP = high percentile of all interaction durations this session
    const sorted = [...this.inpSamples].sort((a, b) => a - b);
    const p98Index = Math.max(0, Math.ceil(sorted.length * 0.98) - 1);
    const inp = sorted[p98Index];

    this.vitals.inp = inp;
    this._updateScreenVital(this.currentRoute, 'inp', inp);

    this.track({
      type: 'inp',
      name: `inp:${interactionName}`,
      durationMs,
      unit: 'ms',
      timestamp: Date.now(),
      metadata: { vital: 'INP', interaction: interactionName, inp, rating: rateInp(inp) },
    });

    if (inp > this.budget.inpMs) {
      this._emitRegression({
        metric: {
          type: 'inp',
          name: `inp:${interactionName}`,
          durationMs: inp,
          timestamp: Date.now(),
        },
        budget: this.budget.inpMs,
        actual: inp,
        exceedancePercent: ((inp - this.budget.inpMs) / this.budget.inpMs) * 100,
      });
    }
  }

  /**
   * Track a layout shift (CLS).
   * `score` is the fractional layout shift score for this individual shift event
   * (impactFraction × distanceFraction, same as web Layout Instability API).
   * Pass `score=1/frameHeight` as an approximation when exact metrics are unavailable.
   */
  trackLayoutShift(context: string, score: number): void {
    const now = nowHr();
    this.layoutShiftEntries.push({ context, score, timestamp: now });

    // Accumulate into the current CLS session window
    const clsSessionScore = this._accumulateCls(now, score);

    this.vitals.cls = clsSessionScore;
    this._updateScreenVital(this.currentRoute, 'cls', clsSessionScore);

    this.track({
      type: 'cls',
      name: `layout_shift:${context}`,
      value: score,
      unit: 'score',
      timestamp: Date.now(),
      metadata: {
        vital: 'CLS',
        context,
        shiftScore: score,
        sessionScore: clsSessionScore,
        rating: rateCls(clsSessionScore),
      },
    });

    if (clsSessionScore > this.budget.clsScore) {
      this._emitRegression({
        metric: {
          type: 'cls',
          name: `cls:${context}`,
          value: clsSessionScore,
          timestamp: Date.now(),
        },
        budget: this.budget.clsScore,
        actual: clsSessionScore,
        exceedancePercent:
          ((clsSessionScore - this.budget.clsScore) / this.budget.clsScore) * 100,
      });
    }
  }

  /**
   * @deprecated Use trackLayoutShift() for accurate CLS scoring.
   * Kept for backward compatibility — maps frame drops to a synthetic CLS score.
   */
  trackFrameDrop(context: string): void {
    // Approximate: each frame drop contributes a fixed synthetic shift score
    const syntheticScore = 0.02;
    this.trackLayoutShift(context, syntheticScore);
  }

  /** Reset CLS windows and layout shift state (call at start of new interaction). */
  resetFrameDrops(): void {
    this.clsWindows = [];
    this.layoutShiftEntries = [];
    this.vitals.cls = 0;
    this._updateScreenVital(this.currentRoute, 'cls', 0);
  }

  getCoreWebVitals(): CoreWebVitals {
    return { ...this.vitals };
  }

  getRatedVitals(): CoreWebVitalsRated {
    return rateVitals(this.vitals);
  }

  // ── TTI — Time to Interactive ─────────────────────────────────────────────

  /**
   * Notify the monitor that a potentially long task just completed.
   * The monitor will probe for TTI resolution after each task.
   * Call from animation/layout callbacks or measure() automatically calls this.
   */
  reportLongTask(durationMs: number): void {
    if (durationMs >= LONG_TASK_THRESHOLD_MS) {
      this._onLongTask();
    }
  }

  /**
   * Signal that the main-thread is now idle (e.g. from a requestIdleCallback shim
   * or after InteractionManager drains). Finalises TTI if quiet window has elapsed.
   */
  reportIdle(): void {
    if (this.ttiState.resolved) return;

    const now = nowHr();
    if (this.ttiState.quietPeriodStart === null) {
      this.ttiState.quietPeriodStart = now;
    }

    const quietMs = now - this.ttiState.quietPeriodStart;
    if (quietMs >= this.ttiState.quietWindowMs) {
      this._resolveTTI(this.ttiState.quietPeriodStart);
    }
  }

  private _onLongTask(): void {
    // Any long task resets the quiet window
    this.ttiState.quietPeriodStart = null;
  }

  private _resolveTTI(quietWindowStart: number): void {
    if (this.ttiState.resolved) return;
    this.ttiState.resolved = true;

    const tti = quietWindowStart - this.ttiState.startTime;
    this.vitals.tti = tti;
    this._updateScreenVital(this.currentRoute, 'tti', tti);

    this.track({
      type: 'tti',
      name: `tti:${this.currentRoute}`,
      durationMs: tti,
      unit: 'ms',
      timestamp: Date.now(),
      metadata: { vital: 'TTI', route: this.currentRoute, rating: rateTti(tti) },
    });

    if (tti > this.budget.ttiMs) {
      this._emitRegression({
        metric: {
          type: 'tti',
          name: `tti:${this.currentRoute}`,
          durationMs: tti,
          timestamp: Date.now(),
        },
        budget: this.budget.ttiMs,
        actual: tti,
        exceedancePercent: ((tti - this.budget.ttiMs) / this.budget.ttiMs) * 100,
      });
    }
  }

  // ── Route Transition Tracking ─────────────────────────────────────────────

  /**
   * Record that the app has navigated to a new route.
   * Call from the NavigationContainer `onStateChange` handler.
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

    // Snapshot vitals before the transition context resets
    this._snapshotVitals(fromRoute);

    // Reset per-route CLS windows on navigation
    this.clsWindows = [];

    // Reset TTI for the new route
    this.ttiState = {
      startTime: nowHr(),
      quietPeriodStart: null,
      quietWindowMs: TTI_QUIET_WINDOW_MS,
      resolved: false,
    };

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
      // Signal idle after navigation settle — contributes to TTI resolution
      this.reportIdle();
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

    // Long-task detection from interaction metrics
    if (
      metric.type === 'interaction' &&
      typeof metric.durationMs === 'number' &&
      metric.durationMs >= LONG_TASK_THRESHOLD_MS
    ) {
      this._onLongTask();
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

  getScreenVitals(screen?: string): ScreenVitals[] {
    if (screen) {
      const sv = this.screenVitalsMap.get(screen);
      return sv ? [sv] : [];
    }
    return Array.from(this.screenVitalsMap.values());
  }

  getVitalsHistory(): VitalsSnapshot[] {
    return [...this.vitalsHistory];
  }

  getLayoutShiftEntries(): LayoutShiftEntry[] {
    return [...this.layoutShiftEntries];
  }

  getAppStateRecords(): AppStateChangeRecord[] {
    return [...this.appStateRecords];
  }

  getSummary(): PerformanceSummary {
    const averages: PerformanceSummary['averages'] = {};
    const p95: PerformanceSummary['p95'] = {};

    const types: MetricType[] = [
      'render', 'interaction', 'network', 'memory', 'route', 'bundle', 'tti', 'inp', 'cls',
    ];
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
      ratedVitals: this.getRatedVitals(),
      screenVitals: this.getScreenVitals(),
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
    if (metric.type === 'tti') return val > this.budget.ttiMs;
    if (metric.type === 'inp') return val > this.budget.inpMs;
    if (metric.type === 'cls') return val > this.budget.clsScore;
    return false;
  }

  // ── Real User Monitoring ──────────────────────────────────────────────────

  /**
   * Configure a RUM endpoint. When set, the monitor will periodically POST
   * session snapshots to the endpoint for real-user monitoring dashboards.
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
      appVersion: undefined,
      metrics: this.getRecentMetrics(100),
      vitals: this.getCoreWebVitals(),
      ratedVitals: this.getRatedVitals(),
      screenVitals: this.getScreenVitals(),
      vitalsHistory: this.getVitalsHistory(),
      summary: {
        averages: summary.averages,
        p95: summary.p95,
        regressions: summary.regressions,
      },
      appStateChanges: this.getAppStateRecords(),
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
    this.clsWindows = [];
    this.layoutShiftEntries = [];
    this.inpSamples = [];
    this.vitalsHistory = [];
    this.screenVitalsMap.clear();
    this.appStateRecords = [];
    this.ttiState = {
      startTime: nowHr(),
      quietPeriodStart: null,
      quietWindowMs: TTI_QUIET_WINDOW_MS,
      resolved: false,
    };
    this.sessionId = generateSessionId();
    this.listeners.forEach((listener) => listener([]));
  }

  /** Clean up AppState listener (call on app unmount / test teardown). */
  destroy(): void {
    this.appStateSubscription?.remove();
    if (this.rumFlushTimer) clearInterval(this.rumFlushTimer);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Accumulate a layout shift score into the current CLS session window.
   * Returns the maximum session window score observed so far (mirrors web spec).
   */
  private _accumulateCls(now: number, score: number): number {
    let currentWindow = this.clsWindows[this.clsWindows.length - 1];

    if (
      !currentWindow ||
      now - currentWindow.lastTime > CLS_SESSION_GAP_MS ||
      now - currentWindow.startTime > CLS_SESSION_MAX_MS
    ) {
      // Start a new session window
      currentWindow = { startTime: now, lastTime: now, score: 0 };
      this.clsWindows.push(currentWindow);
    }

    currentWindow.score += score;
    currentWindow.lastTime = now;

    // CLS = max session window score
    return this.clsWindows.reduce((max, w) => Math.max(max, w.score), 0);
  }

  private _updateScreenVital(
    screen: string,
    vital: keyof Omit<ScreenVitals, 'screen' | 'firstRenderedAt' | 'visitCount'>,
    value: number
  ): void {
    const existing = this.screenVitalsMap.get(screen);
    if (existing) {
      existing[vital] = value;
    } else {
      const entry: ScreenVitals = {
        screen,
        firstRenderedAt: Date.now(),
        visitCount: 1,
      };
      entry[vital] = value;
      this.screenVitalsMap.set(screen, entry);
    }
  }

  private _snapshotVitals(route: string): void {
    const snapshot: VitalsSnapshot = {
      sessionId: this.sessionId,
      route,
      vitals: this.getCoreWebVitals(),
      ratedVitals: this.getRatedVitals(),
      capturedAt: Date.now(),
    };
    this.vitalsHistory.push(snapshot);
    if (this.vitalsHistory.length > MAX_VITALS_HISTORY) {
      this.vitalsHistory = this.vitalsHistory.slice(-MAX_VITALS_HISTORY);
    }
  }

  private _getBudgetFor(metric: PerformanceMetric): number | null {
    if (metric.type === 'render') return this.budget.renderMs;
    if (metric.type === 'network') return this.budget.apiLatencyMs;
    if (metric.type === 'memory') return this.budget.memoryBytes;
    if (metric.type === 'route') return this.budget.routeTransitionMs;
    if (metric.type === 'bundle') return this.budget.bundleSizeBytes;
    if (metric.type === 'tti') return this.budget.ttiMs;
    if (metric.type === 'inp') return this.budget.inpMs;
    if (metric.type === 'cls') return this.budget.clsScore;
    return null;
  }

  private _emitRegression(regression: PerformanceRegression): void {
    this.regressionListeners.forEach((listener) => listener(regression));
    if (__DEV__) {
      console.warn(
        `[Perf] Regression: ${regression.metric.name} — ` +
          `${regression.actual.toFixed(3)} exceeds budget ${regression.budget} ` +
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
