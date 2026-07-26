import { NavigationState, PartialState, Route } from '@react-navigation/native';

export interface NavigationAnalyticsEvent {
  type: 'screen_view' | 'navigation_action' | 'navigation_error' | 'deep_link';
  screenName: string;
  params?: Record<string, unknown>;
  timestamp: number;
  duration?: number;
  previousScreen?: string;
}

class NavigationAnalytics {
  private events: NavigationAnalyticsEvent[] = [];
  private screenLoadTimes: Map<string, number> = new Map();
  private maxEvents = 500;

  trackScreenView(screenName: string, params?: Record<string, unknown>): void {
    const now = Date.now();
    const previousEvent = this.events[this.events.length - 1];

    this.pushEvent({
      type: 'screen_view',
      screenName,
      params,
      timestamp: now,
      previousScreen: previousEvent?.screenName,
    });
  }

  trackNavigationAction(
    action: string,
    screenName: string,
    params?: Record<string, unknown>
  ): void {
    this.pushEvent({
      type: 'navigation_action',
      screenName,
      params: { ...params, action },
      timestamp: Date.now(),
    });
  }

  trackNavigationError(screenName: string, error: string): void {
    this.pushEvent({
      type: 'navigation_error',
      screenName,
      params: { error },
      timestamp: Date.now(),
    });
  }

  trackDeepLink(screenName: string, path: string): void {
    this.pushEvent({
      type: 'deep_link',
      screenName,
      params: { path },
      timestamp: Date.now(),
    });
  }

  startScreenLoad(screenName: string): void {
    this.screenLoadTimes.set(screenName, Date.now());
  }

  endScreenLoad(screenName: string): number | undefined {
    const startTime = this.screenLoadTimes.get(screenName);
    if (!startTime) return undefined;
    const duration = Date.now() - startTime;
    this.screenLoadTimes.delete(screenName);
    return duration;
  }

  getScreenMetrics(): Record<string, { views: number; avgDuration: number }> {
    const metrics: Record<string, { views: number; totalDuration: number; count: number }> = {};

    for (const event of this.events) {
      if (event.type === 'screen_view') {
        if (!metrics[event.screenName]) {
          metrics[event.screenName] = { views: 0, totalDuration: 0, count: 0 };
        }
        metrics[event.screenName].views += 1;
        if (event.duration) {
          metrics[event.screenName].totalDuration += event.duration;
          metrics[event.screenName].count += 1;
        }
      }
    }

    const result: Record<string, { views: number; avgDuration: number }> = {};
    for (const [name, data] of Object.entries(metrics)) {
      result[name] = {
        views: data.views,
        avgDuration: data.count > 0 ? data.totalDuration / data.count : 0,
      };
    }
    return result;
  }

  getRecentEvents(count: number = 20): NavigationAnalyticsEvent[] {
    return this.events.slice(-count);
  }

  getNavigationPath(): string[] {
    return this.events
      .filter((e) => e.type === 'screen_view')
      .slice(-10)
      .map((e) => e.screenName);
  }

  private pushEvent(event: NavigationAnalyticsEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  clear(): void {
    this.events = [];
    this.screenLoadTimes.clear();
  }
}

export const navigationAnalytics = new NavigationAnalytics();
