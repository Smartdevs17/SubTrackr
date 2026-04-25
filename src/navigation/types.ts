import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Home: undefined;
  AddSubscription: undefined;
  SubscriptionDetail: { id: string };
  WalletConnect: undefined;
  CryptoPayment: { subscriptionId?: string } | undefined;
  Community: undefined;
  Profile: { subscriber?: string } | undefined;
  Analytics: undefined;
  InvoiceList: undefined;
  InvoiceDetail: { id: string };
  GDPRSettings: undefined;
  Settings: undefined;
  AdminDashboard: undefined;
  LanguageSettings: undefined;
  SessionManagement: undefined;
  ErrorDashboard: undefined;
  SegmentManagement: undefined;
  SegmentDetail: { segmentId: string };
  Gamification: undefined;
  RevenueReport: undefined;
};

export type TabParamList = {
  HomeTab: NavigatorScreenParams<RootStackParamList> | undefined;
  AddTab: undefined;
  WalletTab: undefined;
  AnalyticsTab: undefined;
  RevenueTab: undefined;
  SettingsTab: undefined;
};
