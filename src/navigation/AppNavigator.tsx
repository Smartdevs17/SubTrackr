import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import AddSubscriptionScreen from '../screens/AddSubscriptionScreen';
import WalletConnectScreen from '../screens/WalletConnectScreen';
import CryptoPaymentScreen from '../screens/CryptoPaymentScreen';
import CommunityScreen from '../screens/CommunityScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SubscriptionDetailScreen from '../screens/SubscriptionDetailScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import GDPRSettingsScreen from '../screens/GDPRSettingsScreen';
import LanguageSettingsScreen from '../screens/LanguageSettingsScreen';
import SessionManagementScreen from '../screens/SessionManagementScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ErrorDashboardScreen from '../screens/ErrorDashboardScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import InvoiceListScreen from '../screens/InvoiceListScreen';
import InvoiceDetailScreen from '../screens/InvoiceDetailScreen';
import { SegmentManagementScreen } from '../screens/SegmentManagementScreen';
import { SegmentDetailScreen } from '../screens/SegmentDetailScreen';
import { GamificationScreen } from '../screens/GamificationScreen';
import RevenueReportScreen from '../screens/RevenueReportScreen';
import { colors } from '../utils/constants';
import { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const HomeStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
    <Stack.Screen
      name="AddSubscription"
      component={AddSubscriptionScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="SubscriptionDetail"
      component={SubscriptionDetailScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="WalletConnect"
      component={WalletConnectScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="CryptoPayment"
      component={CryptoPaymentScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="Community"
      component={CommunityScreen}
      options={{ title: 'Community', headerShown: true }}
    />
    <Stack.Screen
      name="Profile"
      component={ProfileScreen}
      options={{ title: 'Profile', headerShown: true }}
    />
    <Stack.Screen
      name="SegmentManagement"
      component={SegmentManagementScreen}
      options={{ title: 'Segments', headerShown: true }}
    />
    <Stack.Screen
      name="SegmentDetail"
      component={SegmentDetailScreen}
      options={{ title: 'Segment Detail', headerShown: true }}
    />
    <Stack.Screen
      name="Gamification"
      component={GamificationScreen}
      options={{ title: 'Achievements', headerShown: true }}
    />
    <Stack.Screen
      name="InvoiceList"
      component={InvoiceListScreen}
      options={{ title: 'Invoices', headerShown: true }}
    />
    <Stack.Screen
      name="InvoiceDetail"
      component={InvoiceDetailScreen}
      options={{ title: 'Invoice Detail', headerShown: true }}
    />
  </Stack.Navigator>
);

const SettingsStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
    <Stack.Screen
      name="Community"
      component={CommunityScreen}
      options={{ title: 'Community', headerShown: true }}
    />
    <Stack.Screen
      name="Profile"
      component={ProfileScreen}
      options={{ title: 'Profile', headerShown: true }}
    />
    <Stack.Screen
      name="GDPRSettings"
      component={GDPRSettingsScreen}
      options={{ title: 'Privacy Settings', headerShown: true }}
    />
    <Stack.Screen
      name="LanguageSettings"
      component={LanguageSettingsScreen}
      options={{ title: 'Language', headerShown: true }}
    />
    <Stack.Screen
      name="SessionManagement"
      component={SessionManagementScreen}
      options={{ title: 'Sessions', headerShown: true }}
    />
    <Stack.Screen
      name="AdminDashboard"
      component={AdminDashboardScreen}
      options={{ title: 'Admin Dashboard', headerShown: true }}
    />
    <Stack.Screen
      name="ErrorDashboard"
      component={ErrorDashboardScreen}
      options={{ title: 'Error Dashboard', headerShown: true }}
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
      component={AddSubscriptionScreen}
      options={{
        tabBarLabel: 'Add',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>➕</Text>
        ),
      }}
    />
    <Tab.Screen
      name="WalletTab"
      component={WalletConnectScreen}
      options={{
        tabBarLabel: 'Wallet',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>🔗</Text>
        ),
      }}
    />
    <Tab.Screen
      name="AnalyticsTab"
      component={AnalyticsScreen}
      options={{
        tabBarLabel: 'Analytics',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>📊</Text>
        ),
      }}
    />
    <Tab.Screen
      name="RevenueTab"
      component={RevenueReportScreen}
      options={{
        tabBarLabel: 'Revenue',
        tabBarIcon: ({ color, size }) => (
          <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>💰</Text>
        ),
      }}
    />
    <Tab.Screen
      name="SettingsTab"
      component={SettingsStack}
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
