import { renderHook, act } from '@testing-library/react-hooks';
import { NavigationContainer } from '@react-navigation/native';
import React from 'react';
import { navigationAnalytics, NavigationAnalyticsEvent } from '../analytics';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <NavigationContainer>{children}</NavigationContainer>
);

describe('NavigationAnalytics', () => {
  beforeEach(() => {
    navigationAnalytics.clear();
  });

  it('tracks screen view events', () => {
    navigationAnalytics.trackScreenView('Home', { tab: 'main' });
    const events = navigationAnalytics.getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('screen_view');
    expect(events[0].screenName).toBe('Home');
    expect(events[0].params).toEqual({ tab: 'main' });
  });

  it('tracks navigation actions', () => {
    navigationAnalytics.trackNavigationAction('navigate', 'Settings', { source: 'tab' });
    const events = navigationAnalytics.getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('navigation_action');
    expect(events[0].screenName).toBe('Settings');
  });

  it('tracks navigation errors', () => {
    navigationAnalytics.trackNavigationError('Profile', 'Screen not found');
    const events = navigationAnalytics.getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('navigation_error');
    expect(events[0].params).toEqual({ error: 'Screen not found' });
  });

  it('tracks deep links', () => {
    navigationAnalytics.trackDeepLink('SubscriptionDetail', '/subscriptions/123');
    const events = navigationAnalytics.getRecentEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('deep_link');
    expect(events[0].params).toEqual({ path: '/subscriptions/123' });
  });

  it('calculates screen metrics', () => {
    navigationAnalytics.trackScreenView('Home');
    navigationAnalytics.trackScreenView('Home');
    navigationAnalytics.trackScreenView('Settings');

    const metrics = navigationAnalytics.getScreenMetrics();
    expect(metrics.Home.views).toBe(2);
    expect(metrics.Settings.views).toBe(1);
  });

  it('builds navigation path', () => {
    navigationAnalytics.trackScreenView('Home');
    navigationAnalytics.trackScreenView('Settings');
    navigationAnalytics.trackScreenView('Profile');

    const path = navigationAnalytics.getNavigationPath();
    expect(path).toEqual(['Home', 'Settings', 'Profile']);
  });

  it('limits stored events to maxEvents', () => {
    for (let i = 0; i < 600; i++) {
      navigationAnalytics.trackScreenView(`Screen${i}`);
    }
    const events = navigationAnalytics.getRecentEvents(1000);
    expect(events.length).toBeLessThanOrEqual(500);
  });

  it('clears all events', () => {
    navigationAnalytics.trackScreenView('Home');
    navigationAnalytics.clear();
    expect(navigationAnalytics.getRecentEvents()).toHaveLength(0);
  });

  it('tracks previous screen in navigation path', () => {
    navigationAnalytics.trackScreenView('Home');
    navigationAnalytics.trackScreenView('Settings');

    const events = navigationAnalytics.getRecentEvents();
    expect(events[1].previousScreen).toBe('Home');
  });
});
