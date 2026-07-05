import React, { useCallback } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
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
import { lazyScreen, prefetchModule } from '../utils/lazyLoading';
import { RootStackParamList, TabParamList } from './types';
import { useTheme } from '../theme';
import { darkNavigationTheme, lightNavigationTheme } from '../theme/navigationTheme';

import HomeScreen from '../screens/HomeScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useUserStore } from '../store/userStore';
import { FeatureId } from '../types/feature';
import { featureFlagsService } from '../services/featureFlags';
import type { SubscriptionTier } from '../types/subscription';

const AddSubscriptionScreen = lazyScreen(() => import('../screens/AddSubscriptionScreen'));
const CancellationFlowScreen = lazyScreen(() => import('../screens/CancellationFlowScreen'));
const CancellationFunnelDashboard = lazyScreen(
  () => import('../screens/CancellationFunnelDashboard')
);
const WalletConnectScreen = lazyScreen(() => import('../screens/WalletConnectV2Screen'));
const CryptoPaymentScreen = lazyScreen(() => import('../screens/CryptoPaymentScreen'));
const CommunityScreen = lazyScreen(() => import('../screens/CommunityScreen'));
const ProfileScreen = lazyScreen(() => import('../screens/ProfileScreen'));
const SubscriptionDetailScreen = lazyScreen(() => import('../screens/SubscriptionDetailScreen'));
const InvoiceListScreen = lazyScreen(() => import('../screens/InvoiceListScreen'));
const InvoiceDetailScreen = lazyScreen(() => import('../screens/InvoiceDetailScreen'));
const AnalyticsScreen = lazyScreen(() => import('../screens/AnalyticsScreen'));
const SlaDashboard = lazyScreen(() => import('../screens/SlaDashboard'));
const GDPRSettingsScreen = lazyScreen(() => import('../screens/GDPRSettingsScreen'));
const LanguageSettingsScreen = lazyScreen(() => import('../screens/LanguageSettingsScreen'));
const SessionManagementScreen = lazyScreen(() => import('../screens/SessionManagementScreen'));
const CalendarIntegrationScreen = lazyScreen(() => import('../screens/CalendarIntegrationScreen'));
const AccountingExportScreen = lazyScreen(() => import('../screens/AccountingExportScreen'));
const WebhookSettingsScreen = lazyScreen(() => import('../screens/WebhookSettingsScreen'));
const WebhookLogsScreen = lazyScreen(() => import('../screens/WebhookLogsScreen'));
const ErrorDashboardScreen = lazyScreen(() => import('../screens/ErrorDashboardScreen'));
const ImportScreen = lazyScreen(() => import('../screens/ImportScreen'));
const ExportScreen = lazyScreen(() => import('../screens/ExportScreen'));
const BatchOperationsScreen = lazyScreen(() =>
  import('../../app/screens/BatchOperationsScreen').then((m) => ({
    default: m.BatchOperationsScreen,
  }))
);
const AdminDashboardScreen = lazyScreen(() => import('../screens/AdminDashboardScreen'));
const FraudDashboard = lazyScreen(() => import('../screens/FraudDashboard'));
const GroupManagementScreen = lazyScreen(() => import('../screens/GroupManagementScreen'));
const TaxSettingsScreen = lazyScreen(() => import('../screens/TaxSettingsScreen'));
const CreditsAndPrepaymentsScreen = lazyScreen(() => import('../screens/CreditsAndPrepaymentsScreen'));
const TaxComplianceScreen = lazyScreen(() => import('../screens/TaxComplianceScreen'));
const SupportDashboardScreen = lazyScreen(() => import('../screens/SupportDashboardScreen'));
const SegmentManagementScreen = lazyScreen(() =>
  import('../screens/SegmentManagementScreen').then((m) => ({ default: m.SegmentManagementScreen }))
);
const SegmentDetailScreen = lazyScreen(() =>
  import('../screens/SegmentDetailScreen').then((m) => ({ default: m.SegmentDetailScreen }))
);
const GamificationScreen = lazyScreen(() =>
  import('../screens/GamificationScreen').then((m) => ({ default: m.GamificationScreen }))
);
const RevenueReportScreen = lazyScreen(() => import('../screens/RevenueReportScreen'));
const UsageDashboardScreen = lazyScreen(() => import('../screens/UsageDashboard'));
const MerchantOnboardingScreen = lazyScreen(() => import('../screens/MerchantOnboardingScreen'));
const AffiliateDashboardScreen = lazyScreen(() => import('../screens/AffiliateDashboardScreen'));
const LoyaltyDashboardScreen = lazyScreen(() => import('../screens/LoyaltyDashboardScreen'));
const CampaignManagementScreen = lazyScreen(() => import('../screens/CampaignManagementScreen'));
const PromotionManagementScreen = lazyScreen(() => import('../screens/PromotionManagementScreen'));
const DeveloperPortalScreen = lazyScreen(() => import('../screens/DeveloperPortalScreen'));
const SandboxDashboardScreen = lazyScreen(() => import('../screens/SandboxDashboardScreen'));
const ApiKeyManagementScreen = lazyScreen(() => import('../screens/ApiKeyManagementScreen'));
const DocumentationPortalScreen = lazyScreen(() => import('../screens/DocumentationPortalScreen'));
const IntegrationGuidesScreen = lazyScreen(() => import('../screens/IntegrationGuidesScreen'));
const PartnerDashboardScreen = lazyScreen(() => import('../screens/PartnerDashboardScreen'));
const PerformanceDashboardScreen = lazyScreen(
  () => import('../screens/PerformanceDashboardScreen')
);
const EditSubscriptionScreen = lazyScreen(() => import('../screens/EditSubscriptionScreen'));
const ChangePlanScreen = lazyScreen(() => import('../screens/ChangePlanScreen'));
const BillingSettingsScreen = lazyScreen(() => import('../screens/BillingSettingsScreen'));
const CustomerHealthScreen = lazyScreen(() => import('../screens/CustomerHealthScreen'));
const BillingAlignmentScreen = lazyScreen(() => import('../screens/BillingAlignmentScreen'));
const PaymentMethodsScreen = lazyScreen(() =>
  import('../../app/screens/PaymentMethodsScreen').then((m) => ({
    default: m.PaymentMethodsScreen,
  }))
);
const AnalyticsDashboard = lazyScreen(() => import('../../app/screens/AnalyticsDashboard'));
const TrialDetailsScreen = lazyScreen(() => import('../screens/TrialDetailsScreen'));
const RenewalWorkspaceScreen = lazyScreen(() =>
  import('../../app/screens/RenewalWorkspaceScreen').then((m) => ({ default: m.default }))
);
const EntityManagementScreen = lazyScreen(() => import('../screens/EntityManagementScreen'));
const PauseSubscriptionScreen = lazyScreen(() => import('../screens/PauseSubscriptionScreen'));

// Issue #547: GDPR
const PrivacyCenterScreen = lazyScreen(() => import('../screens/PrivacyCenterScreen'));
const DataExportScreen = lazyScreen(() => import('../screens/DataExportScreen'));
// Issue #548: Push notifications
const NotificationPreferencesScreen = lazyScreen(
  () => import('../screens/NotificationPreferencesScreen')
);
// Issue #549: Email templates
const EmailTemplateEditorScreen = lazyScreen(() => import('../screens/EmailTemplateEditorScreen'));
// Issue #550: Advanced dunning
const DunningDashboardScreen = lazyScreen(() => import('../screens/DunningDashboardScreen'));

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
      name="CancellationFunnelDashboard"
      component={CancellationFunnelDashboard}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="SubscriptionDetail"
      component={SubscriptionDetailScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="EditSubscription"
      component={EditSubscriptionScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="ChangePlan"
      component={ChangePlanScreen}
      options={{ title: 'Change Plan', headerShown: true }}
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
      options={{ title: 'Integrations', headerShown: true }}
    />
    <Stack.Screen
      name="TrialDetails"
      component={TrialDetailsScreen}
      options={{ title: 'Trial Details', headerShown: true }}
    />
  </Stack.Navigator>
      name="PartnerDashboard"
      component={PartnerDashboardScreen}
      options={{ title: 'Partner Dashboard', headerShown: true }}
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
      name="WebhookSettings"
      component={WebhookSettingsScreen}
      options={{ title: 'Webhooks', headerShown: true }}
    />
    <Stack.Screen
      name="WebhookLogs"
      component={WebhookLogsScreen}
      options={{ title: 'Delivery Logs', headerShown: true }}
    />
    <Stack.Screen
      name="SessionManagement"
      component={SessionManagementScreen}
      options={{ title: 'Sessions', headerShown: true }}
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
      name="CreditsAndPrepayments"
      component={CreditsAndPrepaymentsScreen}
      options={{ title: 'Credits & Prepayments', headerShown: true }}
      name="TaxCompliance"
      component={TaxComplianceScreen}
      options={{ title: 'Tax Compliance', headerShown: true }}
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
      name="PromotionManagement"
      component={PromotionManagementScreen}
      options={{ headerShown: false }}
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
    <Stack.Screen
      name="PerformanceDashboard"
      component={PerformanceDashboardScreen}
      options={{ title: 'Performance', headerShown: true }}
    />
    <Stack.Screen
      name="CustomerHealth"
      component={CustomerHealthScreen}
      options={{ title: 'Customer Health', headerShown: true }}
    />
    <Stack.Screen
      name="BillingSettings"
      component={BillingSettingsScreen}
      options={{ title: 'Billing Settings', headerShown: true }}
    />
    <Stack.Screen
      name="BillingAlignment"
      component={BillingAlignmentScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="PaymentMethods"
      component={PaymentMethodsScreen}
      options={{ title: 'Payment Methods', headerShown: true }}
    />
    <Stack.Screen
      name="AnalyticsDashboard"
      component={AnalyticsDashboard}
      options={{ title: 'Analytics Dashboard', headerShown: true }}
    />
    {/* Issue #547: GDPR */}
    <Stack.Screen
      name="PrivacyCenter"
      component={PrivacyCenterScreen}
      options={{ title: 'Privacy Center', headerShown: true }}
    />
    <Stack.Screen
      name="DataExport"
      component={DataExportScreen}
      options={{ title: 'Export My Data', headerShown: true }}
    />
    <Stack.Screen
      name="DPALog"
      component={DataExportScreen}
      options={{ title: 'Data Processing Log', headerShown: true }}
    />
    {/* Issue #548: Push notifications */}
    <Stack.Screen
      name="NotificationPreferences"
      component={NotificationPreferencesScreen}
      options={{ title: 'Notification Preferences', headerShown: true }}
    />
    {/* Issue #549: Email templates */}
    <Stack.Screen
      name="EmailTemplateEditor"
      component={EmailTemplateEditorScreen}
      options={{ title: 'Email Template Editor', headerShown: true }}
    />
    {/* Issue #550: Advanced dunning */}
    <Stack.Screen
      name="DunningDashboard"
      component={DunningDashboardScreen}
      options={{ title: 'Dunning Dashboard', headerShown: true }}
    />
  </Stack.Navigator>
);

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
  React.useEffect(() => {
    prefetchModule('AddSubscription', () => import('../screens/AddSubscriptionScreen'));
    prefetchModule('WalletConnect', () => import('../screens/WalletConnectV2Screen'));
    prefetchModule('Analytics', () => import('../screens/AnalyticsScreen'));
    prefetchModule('SubscriptionDetail', () => import('../screens/SubscriptionDetailScreen'));
  }, []);

  const user = useUserStore((state) => state.user);
  const subscriptionTier = useUserStore((state) => state.subscriptionTier);
  const { isDark } = useTheme();

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
      onStateChange={handleStateChange}
      theme={isDark ? darkNavigationTheme : lightNavigationTheme}>
      <TabNavigator />
    </NavigationContainer>
  );
};
