export type RootStackParamList = {
  Home: undefined;
  AddSubscription: undefined;
  SubscriptionDetail: { id: string };
  WalletConnect: undefined;
  CryptoPayment: { subscriptionId?: string };
  Analytics: undefined;
  Settings: undefined;
};

export type TabParamList = {
  HomeTab: undefined;
  AddTab: undefined;
  WalletTab: undefined;
  AnalyticsTab: undefined;
  SettingsTab: undefined;
};
