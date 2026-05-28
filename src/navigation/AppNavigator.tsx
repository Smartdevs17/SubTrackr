import React, { useCallback } from 'react';
import { Text } from 'react-native';
import {
  NavigationContainer,
  LinkingOptions,
  getStateFromPath,
  NavigationState,
  PartialState,
  Route,
} from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import HomeScreen from '../screens/HomeScreen';
import AddSubscriptionScreen from '../screens/AddSubscriptionScreen';
import CancellationFlowScreen from '../screens/CancellationFlowScreen';
import WalletConnectScreen from '../screens/WalletConnectV2Screen';
import CryptoPaymentScreen from '../screens/CryptoPaymentScreen';
import CommunityScreen from '../screens/CommunityScreen';
import ProfileScreen from '../screens/ProfileScreen';
import SubscriptionDetailScreen from '../screens/SubscriptionDetailScreen';
import InvoiceListScreen from '../screens/InvoiceListScreen';
import InvoiceDetailScreen from '../screens/InvoiceDetailScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import SlaDashboard from '../screens/SlaDashboard';
import GDPRSettingsScreen from '../screens/GDPRSettingsScreen';
import LanguageSettingsScreen from '../screens/LanguageSettingsScreen';
import SessionManagementScreen from '../screens/SessionManagementScreen';
import SettingsScreen from '../screens/SettingsScreen';
import CalendarIntegrationScreen from '../screens/CalendarIntegrationScreen';
import AccountingExportScreen from '../screens/AccountingExportScreen';
import WebhookSettingsScreen from '../screens/WebhookSettingsScreen';
import ErrorDashboardScreen from '../screens/ErrorDashboardScreen';
import ImportScreen from '../screens/ImportScreen';
import ExportScreen from '../screens/ExportScreen';
import { BatchOperationsScreen } from '../../app/screens/BatchOperationsScreen';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import FraudDashboard from '../screens/FraudDashboard';
import GroupManagementScreen from '../screens/GroupManagementScreen';
import TaxSettingsScreen from '../screens/TaxSettingsScreen';
import SupportDashboardScreen from '../screens/SupportDashboardScreen';
import { SegmentManagementScreen } from '../screens/SegmentManagementScreen';
import { SegmentDetailScreen } from '../screens/SegmentDetailScreen';
import { GamificationScreen } from '../screens/GamificationScreen';
import RevenueReportScreen from '../screens/RevenueReportScreen';
import UsageDashboardScreen from '../screens/UsageDashboard';
import MerchantOnboardingScreen from '../screens/MerchantOnboardingScreen';
import AffiliateDashboardScreen from '../screens/AffiliateDashboardScreen';
import LoyaltyDashboardScreen from '../screens/LoyaltyDashboardScreen';
import CampaignManagementScreen from '../screens/CampaignManagementScreen';
import DeveloperPortalScreen from '../screens/DeveloperPortalScreen';
import SandboxDashboardScreen from '../screens/SandboxDashboardScreen';
import ApiKeyManagementScreen from '../screens/ApiKeyManagementScreen';
import DocumentationPortalScreen from '../screens/DocumentationPortalScreen';
import IntegrationGuidesScreen from '../screens/IntegrationGuidesScreen';
import { colors } from '../utils/constants';
import { useUserStore } from '../store/userStore';
import { FeatureId } from '../types/feature';
import { featureFlagsService } from '../services/featureFlags';

import { RootStackParamList, TabParamList } from './types';
import type { SubscriptionTier } from '../types/subscription';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const routeFeatureMap: Partial<Record<keyof RootStackParamList, FeatureId>> = {
  CryptoPayment: FeatureId.CRYPTO_INTEGRATION,
  Analytics: FeatureId.ADVANCED_ANALYTICS,
  Export: FeatureId.EXPORT_DATA,
  DeveloperPortal: FeatureId.DEVELOPER_PORTAL,
  SandboxDashboard: FeatureId.SANDBOX_ACCESS,
  ApiKeyManagement: FeatureId.API_ACCESS,
};

const authRequiredRoutes: Set<keyof RootStackParamList> = new Set([
  'Profile',
  'AdminDashboard',
  'ApiKeyManagement',
  'DeveloperPortal',
  'SandboxDashboard',
  'MerchantOnboarding',
  'AffiliateDashboard',
  'LoyaltyDashboard',
  'CampaignManagement',
]);

const requiredParamsByRoute: Partial<Record<keyof RootStackParamList, string[]>> = {
  SubscriptionDetail: ['id'],
  CancellationFlow: ['subscriptionId'],
  InvoiceDetail: ['id'],
  SegmentDetail: ['segmentId'],
};

const getActiveRoute = (
  route: Route<string, object | undefined> | undefined
): Route<string, object | undefined> | undefined => {
  if (!route || !('state' in route) || !route.state || !Array.isArray(route.state.routes)) {
    return route;
  }

  const nested = route.state.routes[route.state.index ?? 0] as Route<string, object | undefined>;
  return getActiveRoute(nested);
};

const hasValidRequiredParams = (route: Route<string, object | undefined> | undefined): boolean => {
  if (!route) return false;
  const expected = requiredParamsByRoute[route.name as keyof RootStackParamList];
  if (!expected) return true;

  const params = route.params as Record<string, unknown> | undefined;
  return expected.every((key) => typeof params?.[key] === 'string' && params?.[key]);
};

const getStateFromPathSafe = (path: string, options?: any) => {
  const state = getStateFromPath(path, options);
  if (!state || !state.routes?.length) return undefined;

  const activeRoute = getActiveRoute(state.routes[state.index ?? 0] as Route<string, object | undefined>);
  if (!hasValidRequiredParams(activeRoute)) return undefined;

  return state;
};

const isRouteAllowed = (
  route: Route<string, object | undefined> | undefined,
  isAuthenticated: boolean,
  subscriptionTier: SubscriptionTier
): boolean => {
  if (!route) return false;

  if (authRequiredRoutes.has(route.name as keyof RootStackParamList) && !isAuthenticated) {
    return false;
  }

  const featureId = routeFeatureMap[route.name as keyof RootStackParamList];
  if (featureId) {
    const feature = featureFlagsService.getFeature(featureId);
    if (!feature || !feature.enabled) {
      return false;
    }

    if (!feature.tierAccess.includes(subscriptionTier)) {
      return false;
    }
  }

  return true;
};

const linking: LinkingOptions<TabParamList> = {
  prefixes: ['subtrackr://', 'https://subtrackr.app'],
  config: {
    screens: {
      HomeTab: {
        path: '',
        screens: {
          Home: 'home',
          AddSubscription: 'subscriptions/add',
          SubscriptionDetail: 'subscriptions/:id',
          CancellationFlow: 'subscriptions/:subscriptionId/cancel',
          WalletConnect: 'wallet/connect',
          CryptoPayment: 'crypto-payment/:subscriptionId?',
          Community: 'community',
          Profile: 'profile/:subscriber?',
          Analytics: 'analytics',
          SlaDashboard: 'sla',
          InvoiceList: 'invoices',
          InvoiceDetail: 'invoices/:id',
          GDPRSettings: 'settings/privacy',
          LanguageSettings: 'settings/language',
          ErrorDashboard: 'errors',
          SegmentManagement: 'segments',
          SegmentDetail: 'segments/:segmentId',
          Gamification: 'gamification',
          FraudDashboard: 'fraud',
          GroupManagement: 'groups',
          SupportDashboard: 'support',
          UsageDashboard: 'usage/:subscriptionId?/:planId?/:name?',
          DeveloperPortal: 'developer',
          SandboxDashboard: 'sandbox',
          ApiKeyManagement: 'api-keys',
          DocumentationPortal: 'docs',
          IntegrationGuides: 'integration-guides',
        },
      },
      AddTab: 'add',
      WalletTab: 'wallet',
      AnalyticsTab: 'analytics',
      RevenueTab: 'revenue',
      SettingsTab: {
        path: 'settings',
        screens: {
          Settings: '',
          CalendarIntegration: 'calendar',
          WebhookSettings: 'webhooks',
          AccountingExport: 'accounting',
          BatchOperations: 'batch',
          AdminDashboard: 'admin',
          FraudDashboard: 'fraud',
          TaxSettings: 'tax',
          SupportDashboard: 'support',
          GroupManagement: 'groups',
          MerchantOnboarding: 'merchant-onboarding',
          AffiliateDashboard: 'affiliate',
          LoyaltyDashboard: 'loyalty',
          CampaignManagement: 'campaigns',
          DeveloperPortal: 'developer',
          DocumentationPortal: 'docs',
          ApiKeyManagement: 'api-keys',
        },
      },
    },
  },
  getStateFromPath: getStateFromPathSafe,
};

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
      name="GroupManagement"
      component={GroupManagementScreen}
      options={{ title: 'Groups', headerShown: true }}
    />
    <Stack.Screen
      name="SupportDashboard"
      component={SupportDashboardScreen}
      options={{ title: 'Support', headerShown: true }}
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
      name="Import"
      component={ImportScreen}
      options={{ title: 'Import Subscriptions', headerShown: true }}
    />
    <Stack.Screen
      name="Export"
      component={ExportScreen}
      options={{ title: 'Export Subscriptions', headerShown: true }}
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
      name="BatchOperations"
      component={BatchOperationsScreen}
      options={{ title: 'Batch Operations', headerShown: true }}
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
    <Stack.Screen
      name="TaxSettings"
      component={TaxSettingsScreen}
      options={{ title: 'Tax Settings', headerShown: true }}
    />
    <Stack.Screen
      name="SupportDashboard"
      component={SupportDashboardScreen}
      options={{ title: 'Support', headerShown: true }}
    />
    <Stack.Screen
      name="GroupManagement"
      component={GroupManagementScreen}
      options={{ title: 'Groups', headerShown: true }}
    />
    <Stack.Screen
      name="MerchantOnboarding"
      component={MerchantOnboardingScreen}
      options={{ title: 'Merchant Onboarding', headerShown: true }}
    />
    <Stack.Screen
      name="AffiliateDashboard"
      component={AffiliateDashboardScreen}
      options={{ title: 'Affiliates', headerShown: true }}
    />
    <Stack.Screen
      name="LoyaltyDashboard"
      component={LoyaltyDashboardScreen}
      options={{ title: 'Loyalty', headerShown: true }}
    />
    <Stack.Screen
      name="CampaignManagement"
      component={CampaignManagementScreen}
      options={{ title: 'Campaigns', headerShown: true }}
    />
    <Stack.Screen
      name="DeveloperPortal"
      component={DeveloperPortalScreen}
      options={{ title: 'Developer Portal', headerShown: true }}
    />
    <Stack.Screen
      name="DocumentationPortal"
      component={DocumentationPortalScreen}
      options={{ title: 'API Documentation', headerShown: true }}
    />
    <Stack.Screen
      name="ApiKeyManagement"
      component={ApiKeyManagementScreen}
      options={{ title: 'API Keys', headerShown: true }}
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
  const user = useUserStore((state) => state.user);
  const subscriptionTier = useUserStore((state) => state.subscriptionTier);

  const handleStateChange = useCallback(
    (state?: PartialState<NavigationState> | undefined) => {
      if (!state) return;
      const activeRoute = getActiveRoute(state.routes[state.index ?? 0] as Route<string, object | undefined>);
      const isAuthenticated = Boolean(user);
      if (!isRouteAllowed(activeRoute, isAuthenticated, subscriptionTier)) {
        console.warn(
          `Blocked navigation to ${activeRoute?.name}. Falling back to HomeTab due to auth/feature gating.`
        );
        if (navigationRef.isReady()) {
          navigationRef.reset({ index: 0, routes: [{ name: 'HomeTab' }] });
        }
      }
    },
    [subscriptionTier, user]
  );

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      onStateChange={handleStateChange}>
      <TabNavigator />
    </NavigationContainer>
  );
};
