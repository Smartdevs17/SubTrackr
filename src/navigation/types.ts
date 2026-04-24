import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Home: undefined;
  AddSubscription: undefined;
  SubscriptionDetail: { id: string };
  WalletConnect: undefined;
  CryptoPayment: { subscriptionId?: string } | undefined;
  Analytics: undefined;
  Settings: undefined;
  AdminDashboard: undefined;
  LanguageSettings: undefined;
  SessionManagement: undefined;
  ErrorDashboard: undefined;
  SegmentManagement: undefined;
  SegmentDetail: { segmentId: string };
  Gamification: undefined;
};

export type TabParamList = {
  HomeTab: NavigatorScreenParams<RootStackParamList> | undefined;
  AddTab: undefined;
  WalletTab: undefined;
  AnalyticsTab: undefined;
  SettingsTab: undefined;
};
