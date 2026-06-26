import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

// ── Critical-path screens (eager) ─────────────────────────────────────────────
// Bundled and compiled to Hermes bytecode in the initial chunk so the first
// screens a user sees have zero load latency. Tier membership is declared in
// app.config.js → extra.screenTiers and enforced by check-performance-budget.js.
import HomeScreen from '../screens/HomeScreen';
import AddSubscriptionScreen from '../screens/AddSubscriptionScreen';
import WalletConnectScreen from '../screens/WalletConnectV2Screen';
import CryptoPaymentScreen from '../screens/CryptoPaymentScreen';
import SubscriptionDetailScreen from '../screens/SubscriptionDetailScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import RevenueReportScreen from '../screens/RevenueReportScreen';
import SettingsScreen from '../screens/SettingsScreen';

import { lazyScreen, namedLazyScreen } from './lazyScreen';
import { colors } from '../utils/constants';
import { RootStackParamList, TabParamList } from './types';

// ── Non-critical screens (lazy) ───────────────────────────────────────────────
// Loaded on demand via dynamic import(); Metro emits each as a separately
// loadable chunk, so their parse/compile cost and memory are only paid when the
// screen is actually visited.
const CancellationFlowScreen = lazyScreen(() => import('../screens/CancellationFlowScreen'));
const CommunityScreen = lazyScreen(() => import('../screens/CommunityScreen'));
const ProfileScreen = lazyScreen(() => import('../screens/ProfileScreen'));
const SlaDashboard = lazyScreen(() => import('../screens/SlaDashboard'));
const GDPRSettingsScreen = lazyScreen(() => import('../screens/GDPRSettingsScreen'));
const LanguageSettingsScreen = lazyScreen(() => import('../screens/LanguageSettingsScreen'));
const SessionManagementScreen = lazyScreen(() => import('../screens/SessionManagementScreen'));
const CalendarIntegrationScreen = lazyScreen(() => import('../screens/CalendarIntegrationScreen'));
const AccountingExportScreen = lazyScreen(() => import('../screens/AccountingExportScreen'));
const WebhookSettingsScreen = lazyScreen(() => import('../screens/WebhookSettingsScreen'));
const ErrorDashboardScreen = lazyScreen(() => import('../screens/ErrorDashboardScreen'));
const AdminDashboardScreen = lazyScreen(() => import('../screens/AdminDashboardScreen'));
const FraudDashboard = lazyScreen(() => import('../screens/FraudDashboard'));
const InvoiceListScreen = lazyScreen(() => import('../screens/InvoiceListScreen'));
const InvoiceDetailScreen = lazyScreen(() => import('../screens/InvoiceDetailScreen'));
const UsageDashboardScreen = lazyScreen(() => import('../screens/UsageDashboard'));
const DeveloperPortalScreen = lazyScreen(() => import('../screens/DeveloperPortalScreen'));
const SandboxDashboardScreen = lazyScreen(() => import('../screens/SandboxDashboardScreen'));
const ApiKeyManagementScreen = lazyScreen(() => import('../screens/ApiKeyManagementScreen'));
const DocumentationPortalScreen = lazyScreen(() => import('../screens/DocumentationPortalScreen'));
const IntegrationGuidesScreen = lazyScreen(() => import('../screens/IntegrationGuidesScreen'));
const SegmentManagementScreen = namedLazyScreen(
  () => import('../screens/SegmentManagementScreen'),
  (m) => m.SegmentManagementScreen
);
const SegmentDetailScreen = namedLazyScreen(
  () => import('../screens/SegmentDetailScreen'),
  (m) => m.SegmentDetailScreen
);
const GamificationScreen = namedLazyScreen(
  () => import('../screens/GamificationScreen'),
  (m) => m.GamificationScreen
);

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
      name="CancellationFlow"
      component={CancellationFlowScreen}
      options={{ title: 'Cancel Subscription', headerShown: true }}
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
      name="SlaDashboard"
      component={SlaDashboard}
      options={{ title: 'SLA Dashboard', headerShown: true }}
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
    <Stack.Screen
      name="UsageDashboard"
      component={UsageDashboardScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="DeveloperPortal"
      component={DeveloperPortalScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="SandboxDashboard"
      component={SandboxDashboardScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="ApiKeyManagement"
      component={ApiKeyManagementScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="DocumentationPortal"
      component={DocumentationPortalScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="IntegrationGuides"
      component={IntegrationGuidesScreen}
      options={{ headerShown: false }}
    />
  </Stack.Navigator>
);

const SettingsStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
    <Stack.Screen
      name="CalendarIntegration"
      component={CalendarIntegrationScreen}
      options={{ title: 'Calendar Integrations', headerShown: true }}
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
      name="WebhookSettings"
      component={WebhookSettingsScreen}
      options={{ title: 'Webhooks', headerShown: true }}
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
      name="AccountingExport"
      component={AccountingExportScreen}
      options={{ title: 'Accounting Export', headerShown: true }}
    />
    <Stack.Screen
      name="SlaDashboard"
      component={SlaDashboard}
      options={{ title: 'SLA Dashboard', headerShown: true }}
    />
    <Stack.Screen
      name="ErrorDashboard"
      component={ErrorDashboardScreen}
      options={{ title: 'Error Dashboard', headerShown: true }}
    />
    <Stack.Screen
      name="FraudDashboard"
      component={FraudDashboard}
      options={{ title: 'Fraud Dashboard', headerShown: true }}
    />
  </Stack.Navigator>
);

const TabNavigator = () => {
  const { t } = useTranslation();

  return (
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
          tabBarLabel: t('navigation.home'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>🏠</Text>
          ),
        }}
      />
      <Tab.Screen
        name="AddTab"
        component={AddSubscriptionScreen}
        options={{
          tabBarLabel: t('navigation.add'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>➕</Text>
          ),
        }}
      />
      <Tab.Screen
        name="WalletTab"
        component={WalletConnectScreen}
        options={{
          tabBarLabel: t('navigation.wallet'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>🔗</Text>
          ),
        }}
      />
      <Tab.Screen
        name="AnalyticsTab"
        component={AnalyticsScreen}
        options={{
          tabBarLabel: t('navigation.analytics'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>📊</Text>
          ),
        }}
      />
      <Tab.Screen
        name="RevenueTab"
        component={RevenueReportScreen}
        options={{
          tabBarLabel: t('navigation.revenue'),
          tabBarIcon: ({ color, size }) => (
            <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>💰</Text>
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
  return (
    <NavigationContainer ref={navigationRef}>
      <TabNavigator />
    </NavigationContainer>
  );
};
