import React, { lazy } from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../utils/constants';
import { RootStackParamList, TabParamList } from './types';
import { LazyScreen } from '../components/common/LazyScreen';

const HomeScreen = lazy(() => import('../screens/HomeScreen'));
const AddSubscriptionScreen = lazy(() => import('../screens/AddSubscriptionScreen'));
const WalletConnectScreen = lazy(() => import('../screens/WalletConnectScreen'));
const CryptoPaymentScreen = lazy(() => import('../screens/CryptoPaymentScreen'));
const SubscriptionDetailScreen = lazy(() => import('../screens/SubscriptionDetailScreen'));
const AnalyticsScreen = lazy(() => import('../screens/AnalyticsScreen'));
const SettingsScreen = lazy(() => import('../screens/SettingsScreen'));

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const HomeStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="Home"
      component={() => <LazyScreen component={HomeScreen} />}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="AddSubscription"
      component={() => <LazyScreen component={AddSubscriptionScreen} />}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="SubscriptionDetail"
      component={() => <LazyScreen component={SubscriptionDetailScreen} />}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="WalletConnect"
      component={() => <LazyScreen component={WalletConnectScreen} />}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="CryptoPayment"
      component={() => <LazyScreen component={CryptoPaymentScreen} />}
      options={{ headerShown: false }}
    />
  </Stack.Navigator>
);

const TabNavigator = () => (
  <Tab.Navigator
    screenOptions={{
      tabBarStyle: {
        backgroundColor: colors.surface,
        borderTopColor: colors.border,
        borderTopWidth: 1,
      },
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textSecondary,
      headerShown: false,
    }}>
    <Tab.Screen
      name="HomeTab"
      component={HomeStack}
      options={{
        tabBarLabel: 'Home',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>🏠</Text>
        ),
      }}
    />
    <Tab.Screen
      name="AddTab"
      component={() => <LazyScreen component={AddSubscriptionScreen} />}
      options={{
        tabBarLabel: 'Add',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>➕</Text>
        ),
      }}
    />
    <Tab.Screen
      name="WalletTab"
      component={() => <LazyScreen component={WalletConnectScreen} />}
      options={{
        tabBarLabel: 'Wallet',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>🔗</Text>
        ),
      }}
    />
    <Tab.Screen
      name="AnalyticsTab"
      component={() => <LazyScreen component={AnalyticsScreen} />}
      options={{
        tabBarLabel: 'Analytics',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>📊</Text>
        ),
      }}
    />
    <Tab.Screen
      name="SettingsTab"
      component={() => <LazyScreen component={SettingsScreen} />}
      options={{
        tabBarLabel: 'Settings',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>⚙️</Text>
        ),
      }}
    />
  </Tab.Navigator>
);

export const AppNavigator = () => {
  return (
    <NavigationContainer ref={navigationRef}>
      <TabNavigator />
    </NavigationContainer>
  );
};
