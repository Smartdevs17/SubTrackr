/**
 * Navigation Performance Benchmarks
 *
 * These benchmarks track navigation performance metrics to ensure
 * the app maintains smooth 60fps navigation transitions.
 *
 * Benchmarks:
 * - Screen render time: < 250ms (p95)
 * - Navigation transition: < 300ms
 * - Deep link resolution: < 500ms
 * - Screen mount to interactive: < 400ms
 */

export interface NavigationBenchmarkResult {
  testName: string;
  duration: number;
  passed: boolean;
  threshold: number;
  timestamp: number;
}

const THRESHOLDS = {
  screenRender: 250,
  navigationTransition: 300,
  deepLinkResolution: 500,
  screenMountToInteractive: 400,
  tabBarPressResponse: 100,
} as const;

class NavigationBenchmark {
  private results: NavigationBenchmarkResult[] = [];

  measureScreenRender(screenName: string, renderFn: () => void): NavigationBenchmarkResult {
    const start = performance.now();
    renderFn();
    const duration = performance.now() - start;

    const result: NavigationBenchmarkResult = {
      testName: `screen_render_${screenName}`,
      duration,
      passed: duration <= THRESHOLDS.screenRender,
      threshold: THRESHOLDS.screenRender,
      timestamp: Date.now(),
    };

    this.results.push(result);
    return result;
  }

  measureNavigationTransition(
    fromScreen: string,
    toScreen: string,
    transitionFn: () => void
  ): NavigationBenchmarkResult {
    const start = performance.now();
    transitionFn();
    const duration = performance.now() - start;

    const result: NavigationBenchmarkResult = {
      testName: `nav_transition_${fromScreen}_to_${toScreen}`,
      duration,
      passed: duration <= THRESHOLDS.navigationTransition,
      threshold: THRESHOLDS.navigationTransition,
      timestamp: Date.now(),
    };

    this.results.push(result);
    return result;
  }

  measureDeepLinkResolution(path: string, resolveFn: () => void): NavigationBenchmarkResult {
    const start = performance.now();
    resolveFn();
    const duration = performance.now() - start;

    const result: NavigationBenchmarkResult = {
      testName: `deep_link_${path.replace(/\//g, '_')}`,
      duration,
      passed: duration <= THRESHOLDS.deepLinkResolution,
      threshold: THRESHOLDS.deepLinkResolution,
      timestamp: Date.now(),
    };

    this.results.push(result);
    return result;
  }

  measureTabBarResponse(pressFn: () => void): NavigationBenchmarkResult {
    const start = performance.now();
    pressFn();
    const duration = performance.now() - start;

    const result: NavigationBenchmarkResult = {
      testName: 'tab_bar_press_response',
      duration,
      passed: duration <= THRESHOLDS.tabBarPressResponse,
      threshold: THRESHOLDS.tabBarPressResponse,
      timestamp: Date.now(),
    };

    this.results.push(result);
    return result;
  }

  getResults(): NavigationBenchmarkResult[] {
    return [...this.results];
  }

  getPassRate(): number {
    if (this.results.length === 0) return 1;
    const passed = this.results.filter((r) => r.passed).length;
    return passed / this.results.length;
  }

  getSummary(): {
    total: number;
    passed: number;
    failed: number;
    avgDuration: number;
    passRate: number;
  } {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    const avgDuration =
      total > 0 ? this.results.reduce((sum, r) => sum + r.duration, 0) / total : 0;

    return {
      total,
      passed,
      failed: total - passed,
      avgDuration,
      passRate: this.getPassRate(),
    };
  }

  clear(): void {
    this.results = [];
  }
}

export const navigationBenchmark = new NavigationBenchmark();
export { THRESHOLDS as NAVIGATION_THRESHOLDS };
