import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { prefetchModule, lazyStack } from '../utils/lazyLoading';
import { RootNavigatorParamList, TabParamList } from './types';
import { useTheme } from '../theme';
import { darkNavigationTheme, lightNavigationTheme } from '../theme/navigationTheme';
import { NavigationErrorBoundary } from './NavigationErrorBoundary';
import { linkingConfig } from './linking';

// HomeTab / SubscriptionStack is the landing tab — load it eagerly so the first
// frame renders without a Suspense boundary flash.
import { SubscriptionStack } from './modules';

// All other stacks are loaded on-demand the first time the user navigates to
// their tab (or prefetched after the first frame via prefetchModule below).
// This keeps analytics, wallet, and settings JS out of the initial bundle.
const AnalyticsStack = lazyStack(
  () => import('./modules/AnalyticsStack').then((m) => ({ default: m.AnalyticsStack })),
  { displayName: 'LazyStack(Analytics)' }
);
const WalletStack = lazyStack(
  () => import('./modules/WalletStack').then((m) => ({ default: m.WalletStack })),
  { displayName: 'LazyStack(Wallet)' }
);
const SettingsStack = lazyStack(
  () => import('./modules/SettingsStack').then((m) => ({ default: m.SettingsStack })),
  { displayName: 'LazyStack(Settings)' }
);

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootNavigatorParamList>();

/**
 * Root Stack Navigator encapsulating tab navigation and global modal screens.
 */
const RootNavigator = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="MainTabs" component={TabNavigator} />
    <Stack.Screen name="SubscriptionStack" component={SubscriptionStack} />
    <Stack.Screen name="AnalyticsStack" component={AnalyticsStack} />
    <Stack.Screen name="WalletStack" component={WalletStack} />
    <Stack.Screen name="SettingsStack" component={SettingsStack} />
  </Stack.Navigator>
);

/**
 * Modular Bottom Tab Navigator organizing main entry points.
 */
const TabNavigator = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: {
          backgroundColor: colors.navigation.tabBar,
          borderTopColor: colors.navigation.tabBarBorder,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.navigation.activeTab,
        tabBarInactiveTintColor: colors.navigation.inactiveTab,
        headerShown: false,
      }}>
      <Tab.Screen
        name="HomeTab"
        component={SubscriptionStack}
        options={{
          tabBarLabel: t('navigation.home'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>ðŸ </Text>
          ),
        }}
      />
      <Tab.Screen
        name="WalletTab"
        component={WalletStack}
        options={{
          tabBarLabel: t('navigation.wallet'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>ðŸ”—</Text>
          ),
        }}
      />
      <Tab.Screen
        name="AnalyticsTab"
        component={AnalyticsStack}
        options={{
          tabBarLabel: t('navigation.analytics'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>ðŸ“Š</Text>
          ),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{
          tabBarLabel: t('navigation.settings'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>âš™ï¸</Text>
          ),
        }}
      />
    </Tab.Navigator>
  );
};

export const AppNavigator = () => {
  React.useEffect(() => {
    prefetchModule('AddSubscription', () => import('../screens/AddSubscriptionScreen'));
    prefetchModule('WalletConnect', () => import('../screens/WalletConnectV2Screen'));
    prefetchModule('Analytics', () => import('../screens/AnalyticsScreen'));
    prefetchModule('SubscriptionDetail', () => import('../screens/SubscriptionDetailScreen'));
  }, []);

  const { isDark } = useTheme();

  return (
    <NavigationErrorBoundary>
      <NavigationContainer linking={linkingConfig}
        ref={navigationRef}
        theme={isDark ? darkNavigationTheme : lightNavigationTheme}>
        <RootNavigator />
      </NavigationContainer>
    </NavigationErrorBoundary>
  );
};

export default AppNavigator;

