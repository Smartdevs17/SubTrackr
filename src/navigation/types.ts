import { NavigatorScreenParams } from '@react-navigation/native';
import {
  useRoute,
  useNavigation,
  RouteProp,
  NativeStackNavigationProp,
} from '@react-navigation/native';
import type { NotificationChannel, NotificationType } from '../types/notification';

// ─────────────────────────────────────────────────────────────────────────────
// Per-stack param lists
//
// Each module stack owns its own param list so TypeScript can enforce which
// routes belong to which navigator. RootStackParamList (below) is kept as the
// intersection of every per-stack list so screens that still reference it
// continue to compile.
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionStackParamList = {
  SubscriptionDashboard: undefined;
  AddSubscription: undefined;
  SubscriptionDetail: { id: string };
  EditSubscription: { id: string };
  ChangePlan: { subscriptionId: string };
  CancellationFlow: { subscriptionId: string };
  PauseSubscription: undefined;
  UsageDashboard: undefined;
  UsageAlerts: undefined;
  PlanTemplates: undefined;
};

export type AnalyticsStackParamList = {
  Analytics: undefined;
  AnalyticsDashboard: undefined;
  RevenueReport: undefined;
  PerformanceDashboard: undefined;
  ChurnPrediction: undefined;
  ForecastingDashboard: undefined;
};

export type SettingsStackParamList = {
  Settings: undefined;
  LanguageSettings: undefined;
  NotificationPreferences: undefined;
  DeliveryStatus: undefined;
  NotificationInbox: undefined;
  EmailTemplateEditor: undefined;
  TemplateVersionHistory: { type: NotificationType; channel: NotificationChannel };
  GDPRSettings: undefined;
  PrivacyCenter: undefined;
  ConsentManagement: undefined;
  SmsConsent: { userId?: string } | undefined;
  DataExport: undefined;
  DPALog: undefined;
  TaxSettings: undefined;
  TaxCompliance: undefined;
  AdvancedSearch: undefined;
};

export type WalletStackParamList = {
  WalletConnect: undefined;
  CryptoPayment: { subscriptionId?: string } | undefined;
  InvoiceList: undefined;
  InvoiceDetail: { id: string };
  InvoiceCustomization: undefined;
  InvoiceMarketplace: undefined;
  InvoiceAnalytics: undefined;
  PaymentMethods: undefined;
  CalendarIntegration: undefined;
};

export type AdminStackParamList = {
  AdminDashboard: undefined;
  MerchantOnboarding: undefined;
  FraudDashboard: undefined;
  ErrorDashboard: undefined;
  SlaDashboard: undefined;
  BillingSettings: undefined;
  BillingAlignment: undefined;
  DunningDashboard: undefined;
  CreditsAndPrepayments: undefined;
  SessionManagement: undefined;
  RoleManagement: undefined;
  CustomerHealth: undefined;
};

export type DeveloperStackParamList = {
  DeveloperPortal: undefined;
  ApiPlayground: undefined;
  SandboxDashboard: undefined;
  ApiKeyManagement: undefined;
  ApiKeys: undefined;
  DocumentationPortal: undefined;
  IntegrationGuides: undefined;
  WebhookSettings: undefined;
  WebhookLogs: undefined;
  Import: undefined;
  Export: undefined;
  BatchOperations: undefined;
  AccountingExport: undefined;
};

export type SocialStackParamList = {
  Community: undefined;
  Profile: { subscriber?: string } | undefined;
  Gamification: undefined;
  LoyaltyDashboard: undefined;
  AffiliateDashboard: undefined;
  CampaignManagement: undefined;
  PromotionManagement: undefined;
  SegmentManagement: undefined;
  SegmentDetail: { segmentId: string };
  GroupManagement: undefined;
  SupportDashboard: undefined;
  TrialDetails: undefined;
  NotFound: { reason?: string };
};

// ─────────────────────────────────────────────────────────────────────────────
// Composite types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Union of every per-stack param list. Kept for backward compatibility so that
 * screens importing `RootStackParamList` still get typed route params via
 * `RouteProp<RootStackParamList, 'RouteName'>`.
 *
 * Prefer importing the specific stack param list (e.g. `SubscriptionStackParamList`)
 * when you know which stack a screen belongs to.
 */
export type RootStackParamList = SubscriptionStackParamList &
  AnalyticsStackParamList &
  SettingsStackParamList &
  WalletStackParamList &
  AdminStackParamList &
  DeveloperStackParamList &
  SocialStackParamList;

/** Bottom-tab navigator. Each tab renders one module stack. */
export type TabParamList = {
  HomeTab: NavigatorScreenParams<SubscriptionStackParamList> | undefined;
  WalletTab: NavigatorScreenParams<WalletStackParamList> | undefined;
  AnalyticsTab: NavigatorScreenParams<AnalyticsStackParamList> | undefined;
  SettingsTab: NavigatorScreenParams<SettingsStackParamList> | undefined;
};

/** Root native-stack navigator. Contains the tab navigator plus standalone stacks. */
export type RootNavigatorParamList = {
  MainTabs: NavigatorScreenParams<TabParamList> | undefined;
  SubscriptionStack: NavigatorScreenParams<SubscriptionStackParamList> | undefined;
  AnalyticsStack: NavigatorScreenParams<AnalyticsStackParamList> | undefined;
  WalletStack: NavigatorScreenParams<WalletStackParamList> | undefined;
  SettingsStack: NavigatorScreenParams<SettingsStackParamList> | undefined;
};

// ─────────────────────────────────────────────────────────────────────────────
// Typed navigation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typed wrapper around `useRoute` for any route in `RootStackParamList`.
 * Usage:  const route = useAppRoute<'SegmentDetail'>();
 */
export function useAppRoute<RouteName extends keyof RootStackParamList>() {
  return useRoute<RouteProp<RootStackParamList, RouteName>>();
}

/**
 * Typed wrapper around `useNavigation` for any route in `RootStackParamList`.
 * The `RouteName` generic is propagated to `NativeStackNavigationProp` so that
 * `navigation.setOptions(...)` is typed for the current screen.
 * Usage:  const navigation = useAppNavigation<'SegmentDetail'>();
 */
export function useAppNavigation<RouteName extends keyof RootStackParamList>() {
  return useNavigation<NativeStackNavigationProp<RootStackParamList, RouteName>>();
}
