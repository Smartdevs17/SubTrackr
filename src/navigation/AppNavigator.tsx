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
import { linkingConfig } from './linking';
import { getFeatureModulePreloads } from './modules';
import {
  AddSubscriptionScreen,
  CancellationFlowScreen,
  ChangePlanScreen,
  CommunityScreen,
  CryptoPaymentScreen,
  EditSubscriptionScreen,
  GamificationScreen,
  GroupManagementScreen,
  HomeScreen,
  InvoiceDetailScreen,
  InvoiceListScreen,
  NotFoundScreen,
  ProfileScreen,
  SegmentDetailScreen,
  SegmentManagementScreen,
  SlaDashboard,
  SubscriptionDetailScreen,
  SupportDashboardScreen,
  UsageDashboardScreen,
  WalletConnectScreen,
} from './modules/homeModule';
import {
  AccountingExportScreen,
  AdminDashboardScreen,
  AffiliateDashboardScreen,
  AnalyticsDashboard,
  BatchOperationsScreen,
  BillingSettingsScreen,
  CalendarIntegrationScreen,
  CampaignManagementScreen,
  ErrorDashboardScreen,
  ExportScreen,
  FraudDashboard,
  GDPRSettingsScreen,
  ImportScreen,
  LanguageSettingsScreen,
  LoyaltyDashboardScreen,
  MerchantOnboardingScreen,
  PaymentMethodsScreen,
  PerformanceDashboardScreen,
  SessionManagementScreen,
  SettingsScreen,
  TaxSettingsScreen,
  WebhookSettingsScreen,
} from './modules/settingsModule';
import {
  ApiKeyManagementScreen,
  DeveloperPortalScreen,
  DocumentationPortalScreen,
  IntegrationGuidesScreen,
  SandboxDashboardScreen,
} from './modules/developerModule';
import { AnalyticsScreen, RevenueReportScreen } from './modules/analyticsModule';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const HomeStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
    <Stack.Screen name="AddSubscription" component={AddSubscriptionScreen} options={{ headerShown: false }} />
    <Stack.Screen name="CancellationFlow" component={CancellationFlowScreen} options={{ title: 'Cancel Subscription', headerShown: true }} />
    <Stack.Screen name="SubscriptionDetail" component={SubscriptionDetailScreen} options={{ headerShown: false }} />
    <Stack.Screen name="EditSubscription" component={EditSubscriptionScreen} options={{ headerShown: false }} />
    <Stack.Screen name="ChangePlan" component={ChangePlanScreen} options={{ title: 'Change Plan', headerShown: true }} />
    <Stack.Screen name="WalletConnect" component={WalletConnectScreen} options={{ headerShown: false }} />
    <Stack.Screen name="CryptoPayment" component={CryptoPaymentScreen} options={{ headerShown: false }} />
    <Stack.Screen name="Community" component={CommunityScreen} options={{ title: 'Community', headerShown: true }} />
    <Stack.Screen name="SlaDashboard" component={SlaDashboard} options={{ title: 'SLA Dashboard', headerShown: true }} />
    <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile', headerShown: true }} />
    <Stack.Screen name="SegmentManagement" component={SegmentManagementScreen} options={{ title: 'Segments', headerShown: true }} />
    <Stack.Screen name="SegmentDetail" component={SegmentDetailScreen} options={{ title: 'Segment Detail', headerShown: true }} />
    <Stack.Screen name="Gamification" component={GamificationScreen} options={{ title: 'Achievements', headerShown: true }} />
    <Stack.Screen name="InvoiceList" component={InvoiceListScreen} options={{ title: 'Invoices', headerShown: true }} />
    <Stack.Screen name="InvoiceDetail" component={InvoiceDetailScreen} options={{ title: 'Invoice Detail', headerShown: true }} />
    <Stack.Screen name="GroupManagement" component={GroupManagementScreen} options={{ title: 'Groups', headerShown: true }} />
    <Stack.Screen name="SupportDashboard" component={SupportDashboardScreen} options={{ title: 'Support', headerShown: true }} />
    <Stack.Screen name="UsageDashboard" component={UsageDashboardScreen} options={{ headerShown: false }} />
    <Stack.Screen name="DeveloperPortal" component={DeveloperPortalScreen} options={{ headerShown: false }} />
    <Stack.Screen name="SandboxDashboard" component={SandboxDashboardScreen} options={{ headerShown: false }} />
    <Stack.Screen name="ApiKeyManagement" component={ApiKeyManagementScreen} options={{ headerShown: false }} />
    <Stack.Screen name="DocumentationPortal" component={DocumentationPortalScreen} options={{ headerShown: false }} />
    <Stack.Screen name="IntegrationGuides" component={IntegrationGuidesScreen} options={{ headerShown: false }} />
    <Stack.Screen name="NotFound" component={NotFoundScreen} options={{ title: 'Not Found', headerShown: true }} />
  </Stack.Navigator>
);

const SettingsStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
    <Stack.Screen name="CalendarIntegration" component={CalendarIntegrationScreen} options={{ title: 'Calendar Integrations', headerShown: true }} />
    <Stack.Screen name="Import" component={ImportScreen} options={{ title: 'Import Subscriptions', headerShown: true }} />
    <Stack.Screen name="Export" component={ExportScreen} options={{ title: 'Export Subscriptions', headerShown: true }} />
    <Stack.Screen name="Community" component={CommunityScreen} options={{ title: 'Community', headerShown: true }} />
    <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile', headerShown: true }} />
    <Stack.Screen name="GDPRSettings" component={GDPRSettingsScreen} options={{ title: 'Privacy Settings', headerShown: true }} />
    <Stack.Screen name="LanguageSettings" component={LanguageSettingsScreen} options={{ title: 'Language', headerShown: true }} />
    <Stack.Screen name="BatchOperations" component={BatchOperationsScreen} options={{ title: 'Batch Operations', headerShown: true }} />
    <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Admin Dashboard', headerShown: true }} />
    <Stack.Screen name="AccountingExport" component={AccountingExportScreen} options={{ title: 'Accounting Export', headerShown: true }} />
    <Stack.Screen name="SlaDashboard" component={SlaDashboard} options={{ title: 'SLA Dashboard', headerShown: true }} />
    <Stack.Screen name="ErrorDashboard" component={ErrorDashboardScreen} options={{ title: 'Error Dashboard', headerShown: true }} />
    <Stack.Screen name="WebhookSettings" component={WebhookSettingsScreen} options={{ title: 'Webhooks', headerShown: true }} />
    <Stack.Screen name="SessionManagement" component={SessionManagementScreen} options={{ title: 'Sessions', headerShown: true }} />
    <Stack.Screen name="FraudDashboard" component={FraudDashboard} options={{ title: 'Fraud Dashboard', headerShown: true }} />
    <Stack.Screen name="TaxSettings" component={TaxSettingsScreen} options={{ title: 'Tax Settings', headerShown: true }} />
    <Stack.Screen name="SupportDashboard" component={SupportDashboardScreen} options={{ title: 'Support', headerShown: true }} />
    <Stack.Screen name="GroupManagement" component={GroupManagementScreen} options={{ title: 'Groups', headerShown: true }} />
    <Stack.Screen name="MerchantOnboarding" component={MerchantOnboardingScreen} options={{ title: 'Merchant Onboarding', headerShown: true }} />
    <Stack.Screen name="AffiliateDashboard" component={AffiliateDashboardScreen} options={{ title: 'Affiliates', headerShown: true }} />
    <Stack.Screen name="LoyaltyDashboard" component={LoyaltyDashboardScreen} options={{ title: 'Loyalty', headerShown: true }} />
    <Stack.Screen name="CampaignManagement" component={CampaignManagementScreen} options={{ title: 'Campaigns', headerShown: true }} />
    <Stack.Screen name="DeveloperPortal" component={DeveloperPortalScreen} options={{ title: 'Developer Portal', headerShown: true }} />
    <Stack.Screen name="DocumentationPortal" component={DocumentationPortalScreen} options={{ title: 'API Documentation', headerShown: true }} />
    <Stack.Screen name="ApiKeyManagement" component={ApiKeyManagementScreen} options={{ title: 'API Keys', headerShown: true }} />
    <Stack.Screen name="PerformanceDashboard" component={PerformanceDashboardScreen} options={{ title: 'Performance', headerShown: true }} />
    <Stack.Screen name="BillingSettings" component={BillingSettingsScreen} options={{ title: 'Billing Settings', headerShown: true }} />
    <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} options={{ title: 'Payment Methods', headerShown: true }} />
    <Stack.Screen name="AnalyticsDashboard" component={AnalyticsDashboard} options={{ title: 'Analytics Dashboard', headerShown: true }} />
  </Stack.Navigator>
);

const TabNavigator = () => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: colors.navigation.tabBar, borderTopColor: colors.navigation.tabBarBorder, borderTopWidth: 1 },
        tabBarActiveTintColor: colors.navigation.activeTab,
        tabBarInactiveTintColor: colors.navigation.inactiveTab,
        headerShown: false,
      }}>
      <Tab.Screen name="HomeTab" component={HomeStack} options={{ tabBarLabel: t('navigation.home'), tabBarIcon: ({ color, size }) => <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>🏠</Text> }} />
      <Tab.Screen name="AddTab" component={AddSubscriptionScreen} options={{ tabBarLabel: t('navigation.add'), tabBarIcon: ({ color, size }) => <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>➕</Text> }} />
      <Tab.Screen name="WalletTab" component={WalletConnectScreen} options={{ tabBarLabel: t('navigation.wallet'), tabBarIcon: ({ color, size }) => <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>🔗</Text> }} />
      <Tab.Screen name="AnalyticsTab" component={AnalyticsScreen} options={{ tabBarLabel: t('navigation.analytics'), tabBarIcon: ({ color, size }) => <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>📊</Text> }} />
      <Tab.Screen name="RevenueTab" component={RevenueReportScreen} options={{ tabBarLabel: t('navigation.revenue'), tabBarIcon: ({ color, size }) => <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>💰</Text> }} />
      <Tab.Screen name="SettingsTab" component={SettingsStack} options={{ tabBarLabel: t('navigation.settings'), tabBarIcon: ({ color, size }) => <Text style={{ color, fontSize: size, fontWeight: 'bold' }}>⚙️</Text> }} />
    </Tab.Navigator>
  );
};

export const AppNavigator = () => {
  React.useEffect(() => {
    prefetchModule('AddSubscription', () => import('../screens/AddSubscriptionScreen'));
    prefetchModule('WalletConnect', () => import('../screens/WalletConnectV2Screen'));
    prefetchModule('Analytics', () => import('../screens/AnalyticsScreen'));
    prefetchModule('SubscriptionDetail', () => import('../screens/SubscriptionDetailScreen'));
    getFeatureModulePreloads().forEach((load, index) => prefetchModule(`feature-module-${index}`, load));
  }, []);

  const { isDark } = useTheme();

  return (
    <NavigationContainer ref={navigationRef} linking={linkingConfig} theme={isDark ? darkNavigationTheme : lightNavigationTheme}>
      <TabNavigator />
    </NavigationContainer>
  );
};
