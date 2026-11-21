import { createNavigationContainerRef } from '@react-navigation/native';

import type {
  RootNavigatorParamList,
  TabParamList,
  SubscriptionStackParamList,
  SettingsStackParamList,
  WalletStackParamList,
  AnalyticsStackParamList,
} from './types';

export const navigationRef = createNavigationContainerRef<RootNavigatorParamList>();

/**
 * Navigate to a top-level tab.
 */
export const navigateTab = <RouteName extends keyof TabParamList>(
  name: RouteName,
  params?: TabParamList[RouteName]
) => {
  if (navigationRef.isReady()) {
    (navigationRef as ReturnType<typeof createNavigationContainerRef<TabParamList>>).navigate(
      name,
      params
    );
  }
};

/**
 * Navigate to a screen inside the SubscriptionStack (HomeTab).
 */
export const navigateSubscription = <RouteName extends keyof SubscriptionStackParamList>(
  screen: RouteName,
  params?: SubscriptionStackParamList[RouteName]
) => {
  if (navigationRef.isReady()) {
    navigationRef.navigate('MainTabs', {
      screen: 'HomeTab',
      params: { screen, params } as SubscriptionStackParamList[RouteName] extends undefined
        ? never
        : { screen: RouteName; params: SubscriptionStackParamList[RouteName] },
    } as any);
  }
};

/**
 * Navigate to a screen inside the SettingsStack (SettingsTab).
 */
export const navigateSettings = <RouteName extends keyof SettingsStackParamList>(
  screen: RouteName,
  params?: SettingsStackParamList[RouteName]
) => {
  if (navigationRef.isReady()) {
    navigationRef.navigate('MainTabs', {
      screen: 'SettingsTab',
      params: { screen, params },
    } as any);
  }
};

/**
 * Navigate to a screen inside the WalletStack (WalletTab).
 */
export const navigateWallet = <RouteName extends keyof WalletStackParamList>(
  screen: RouteName,
  params?: WalletStackParamList[RouteName]
) => {
  if (navigationRef.isReady()) {
    navigationRef.navigate('MainTabs', {
      screen: 'WalletTab',
      params: { screen, params },
    } as any);
  }
};

/**
 * Navigate to a screen inside the AnalyticsStack (AnalyticsTab).
 */
export const navigateAnalytics = <RouteName extends keyof AnalyticsStackParamList>(
  screen: RouteName,
  params?: AnalyticsStackParamList[RouteName]
) => {
  if (navigationRef.isReady()) {
    navigationRef.navigate('MainTabs', {
      screen: 'AnalyticsTab',
      params: { screen, params },
    } as any);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compat aliases
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use `navigateSubscription` instead. */
export const navigateHomeScreen = navigateSubscription;

/** @deprecated Use `navigateSettings` instead. */
export const navigateSettingsScreen = navigateSettings;
