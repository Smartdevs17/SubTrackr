import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { prefetchModule } from '../utils/lazyLoading';
import { RootStackParamList, TabParamList } from './types';
import { useTheme } from '../theme';
import { darkNavigationTheme, lightNavigationTheme } from '../theme/navigationTheme';
import { NavigationErrorBoundary } from './NavigationErrorBoundary';

// Import feature-based stack modules
import {
  SubscriptionStack,
  AnalyticsStack,
  SettingsStack,
  WalletStack,
} from './modules';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

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
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>🏠</Text>
          ),
        }}
      />
      <Tab.Screen
        name="WalletTab"
        component={WalletStack}
        options={{
          tabBarLabel: t('navigation.wallet'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>🔗</Text>
          ),
        }}
      />
      <Tab.Screen
        name="AnalyticsTab"
        component={AnalyticsStack}
        options={{
          tabBarLabel: t('navigation.analytics'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>📊</Text>
          ),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStack}
        options={{
          tabBarLabel: t('navigation.settings'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>⚙️</Text>
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
      <NavigationContainer
        ref={navigationRef}
        theme={isDark ? darkNavigationTheme : lightNavigationTheme}>
        <RootNavigator />
      </NavigationContainer>
    </NavigationErrorBoundary>
  );
};

export default AppNavigator;
