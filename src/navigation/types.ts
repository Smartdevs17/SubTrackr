import { NavigatorScreenParams, RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BillingCycle } from '../types/subscription';

/**
 * Navigation types are intentionally explicit to avoid runtime route mismatches.
 *
 * Migration guide:
 * 1. Replace untyped `useNavigation()` with `useAppNavigation<'RouteName'>()`.
 * 2. Replace untyped `useRoute()` with `useAppRoute<'RouteName'>()`.
 * 3. For external navigation, use the typed `navigationRef` helpers in `navigationRef.ts`.
 */

export type RootStackParamList = {
  Home: undefined;
  AddSubscription: undefined;
  SubscriptionDetail: { id: string };
  EditSubscription: { id: string };
  CancellationFlow: { subscriptionId: string };
  CancellationFunnelDashboard: undefined;
  WalletConnect: undefined;
  CryptoPayment: { subscriptionId?: string } | undefined;
  Community: undefined;
  Profile: { subscriber?: string } | undefined;
  Analytics: undefined;
  SlaDashboard: undefined;
  InvoiceList: undefined;
  InvoiceDetail: { id: string };
  GDPRSettings: undefined;
  Settings: undefined;
  CalendarIntegration: undefined;
  WebhookSettings: undefined;
  WebhookLogs: { webhookId: string };
  AccountingExport: undefined;
  AdminDashboard: undefined;
  LanguageSettings: undefined;
  SessionManagement: undefined;
  ErrorDashboard: undefined;
  Import: undefined;
  Export: undefined;
  BatchOperations: undefined;
  SegmentManagement: undefined;
  SegmentDetail: { segmentId: string };
  Gamification: undefined;
  FraudDashboard: undefined;
  GroupManagement: undefined;
  TaxSettings: undefined;
  SupportDashboard: undefined;
  UsageDashboard: { subscriptionId?: string; planId?: string; name?: string } | undefined;
  DeveloperPortal: undefined;
  SandboxDashboard: undefined;
  ApiKeyManagement: undefined;
  DocumentationPortal: undefined;
  IntegrationGuides: undefined;
  MerchantOnboarding: undefined;
  AffiliateDashboard: undefined;
  LoyaltyDashboard: undefined;
  CampaignManagement: undefined;
  PromotionManagement: undefined;
  PerformanceDashboard: undefined;
  BillingSettings: undefined;
  BillingAlignment: undefined;
  ChangePlan: { subscriptionId: string };
  PaymentMethods: undefined;
  AnalyticsDashboard: undefined;
  NotFound: { reason?: string };
};

export type TabParamList = {
  HomeTab: NavigatorScreenParams<RootStackParamList> | undefined;
  AddTab: undefined;
  WalletTab: undefined;
  AnalyticsTab: undefined;
  RevenueTab: undefined;
  SettingsTab: NavigatorScreenParams<RootStackParamList> | undefined;
};

export type RootStackScreenRouteProp<RouteName extends keyof RootStackParamList> =
  RouteProp<RootStackParamList, RouteName>;

export type RootStackScreenNavigationProp<RouteName extends keyof RootStackParamList> =
  NativeStackNavigationProp<RootStackParamList, RouteName>;

export type AppTabNavigationProp<RouteName extends keyof TabParamList> =
  NativeStackNavigationProp<TabParamList, RouteName>;

export const useAppNavigation = <RouteName extends keyof RootStackParamList>() =>
  useNavigation<RootStackScreenNavigationProp<RouteName>>();

export const useAppRoute = <RouteName extends keyof RootStackParamList>() =>
  useRoute<RootStackScreenRouteProp<RouteName>>();

export const useAppTabNavigation = <RouteName extends keyof TabParamList>() =>
  useNavigation<AppTabNavigationProp<RouteName>>();
