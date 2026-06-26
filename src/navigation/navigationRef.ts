import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList, TabParamList } from './types';

export const navigationRef = createNavigationContainerRef<TabParamList>();

export const navigateTab = <RouteName extends keyof TabParamList>(
  name: RouteName,
  params?: TabParamList[RouteName]
) => {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
};

export const navigateHomeScreen = <RouteName extends keyof RootStackParamList>(
  screen: RouteName,
  params?: RootStackParamList[RouteName]
) => {
  if (navigationRef.isReady()) {
    navigationRef.navigate('HomeTab', { screen, params });
  }
};

export const navigateSettingsScreen = <RouteName extends keyof RootStackParamList>(
  screen: RouteName,
  params?: RootStackParamList[RouteName]
) => {
  if (navigationRef.isReady()) {
    navigationRef.navigate('SettingsTab', { screen, params });
  }
};
