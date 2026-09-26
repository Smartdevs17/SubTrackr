import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { lazyScreen } from '../../utils/lazyLoading';
import { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const WalletConnectScreen = lazyScreen(() => import('../../screens/WalletConnectV2Screen'));
const CryptoPaymentScreen = lazyScreen(() => import('../../screens/CryptoPaymentScreen'));
const InvoiceListScreen = lazyScreen(() => import('../../screens/InvoiceListScreen'));
const InvoiceDetailScreen = lazyScreen(() => import('../../screens/InvoiceDetailScreen'));
const InvoiceCustomizationScreen = lazyScreen(() =>
  import('../../../app/screens/InvoiceCustomizationScreen').then((m) => ({
    default: m.InvoiceCustomizationScreen,
  }))
);
const InvoiceMarketplaceScreen = lazyScreen(() =>
  import('../../../app/screens/InvoiceMarketplaceScreen').then((m) => ({
    default: m.InvoiceMarketplaceScreen,
  }))
);
const InvoiceAnalyticsScreen = lazyScreen(() =>
  import('../../../app/screens/InvoiceAnalyticsScreen').then((m) => ({
    default: m.InvoiceAnalyticsScreen,
  }))
);
const PaymentMethodsScreen = lazyScreen(() =>
  import('../../../app/screens/PaymentMethodsScreen').then((m) => ({
    default: m.PaymentMethodsScreen,
  }))
);
const CalendarIntegrationScreen = lazyScreen(
  () => import('../../screens/CalendarIntegrationScreen')
);

export const WalletStack = () => (
  <Stack.Navigator>
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
      name="InvoiceCustomization"
      component={InvoiceCustomizationScreen}
      options={{ title: 'Invoice Customization', headerShown: true }}
    />
    <Stack.Screen
      name="InvoiceMarketplace"
      component={InvoiceMarketplaceScreen}
      options={{ title: 'Template Marketplace', headerShown: true }}
    />
    <Stack.Screen
      name="InvoiceAnalytics"
      component={InvoiceAnalyticsScreen}
      options={{ title: 'Invoice Analytics', headerShown: true }}
    />
    <Stack.Screen
      name="PaymentMethods"
      component={PaymentMethodsScreen}
      options={{ title: 'Payment Methods', headerShown: true }}
    />
    <Stack.Screen
      name="CalendarIntegration"
      component={CalendarIntegrationScreen}
      options={{ title: 'Calendar Integrations', headerShown: true }}
    />
  </Stack.Navigator>
);
