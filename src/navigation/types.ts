import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Home: undefined;
  AddSubscription: undefined;
  SubscriptionDetail: { id: string };
  EditSubscription: { id: string };
  CancellationFlow: { subscriptionId: string };
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
  UsageDashboard: undefined;
  DeveloperPortal: undefined;
  SandboxDashboard: undefined;
  ApiKeyManagement: undefined;
  DocumentationPortal: undefined;
  IntegrationGuides: undefined;
  MerchantOnboarding: undefined;
  AffiliateDashboard: undefined;
  LoyaltyDashboard: undefined;
  CampaignManagement: undefined;
  PerformanceDashboard: undefined;
  BillingSettings: undefined;
  ChangePlan: { subscriptionId: string };
  PaymentMethods: undefined;
  AnalyticsDashboard: undefined;
  NotFound: { reason?: string };
  // Issue #547: GDPR
  PrivacyCenter: undefined;
  DataExport: undefined;
  DPALog: undefined;
  // Issue #548: Push notifications
  NotificationPreferences: undefined;
  // Issue #549: Email templates
  EmailTemplateEditor: undefined;
  // Issue #550: Advanced dunning
  DunningDashboard: undefined;
};

export type TabParamList = {
  HomeTab: NavigatorScreenParams<RootStackParamList> | undefined;
  AddTab: undefined;
  WalletTab: undefined;
  AnalyticsTab: undefined;
  RevenueTab: undefined;
  SettingsTab: NavigatorScreenParams<RootStackParamList> | undefined;
};
