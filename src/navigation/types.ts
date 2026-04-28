import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Home: undefined;
  AddSubscription: undefined;
  SubscriptionDetail: { id: string };
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
  SegmentManagement: undefined;
  SegmentDetail: { segmentId: string };
  Gamification: undefined;
  RevenueReport: undefined;
  UsageDashboard: { subscriptionId: string; planId: string; name: string };
  MerchantOnboarding: undefined;
  AffiliateDashboard: undefined;
};

export type TabParamList = {
  HomeTab: NavigatorScreenParams<RootStackParamList> | undefined;
  AddTab: undefined;
  WalletTab: undefined;
  AnalyticsTab: undefined;
  RevenueTab: undefined;
  SettingsTab: undefined;
};
