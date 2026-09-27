import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { lazyScreen } from '../../utils/lazyLoading';
import { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AnalyticsScreen = lazyScreen(() => import('../../screens/AnalyticsScreen'));
const RevenueReportScreen = lazyScreen(() => import('../../screens/RevenueReportScreen'));
const PerformanceDashboardScreen = lazyScreen(
  () => import('../../screens/PerformanceDashboardScreen')
);
const ChurnPredictionScreen = lazyScreen(
  () => import('../../../app/screens/ChurnPredictionScreen')
);
const UsageDashboardScreen = lazyScreen(() => import('../../screens/UsageDashboard'));
const UsageAlertsScreen = lazyScreen(() => import('../../screens/UsageAlertsScreen'));

const PaymentFailureListScreen = lazyScreen(() => import('../../screens/PaymentFailureListScreen'));
const PaymentFailureDetailScreen = lazyScreen(() => import('../../screens/PaymentFailureDetailScreen'));

export const AnalyticsStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="Analytics" component={AnalyticsScreen} options={{ headerShown: false }} />
    <Stack.Screen
      name="RevenueReport"
      component={RevenueReportScreen}
      options={{ title: 'Revenue Report', headerShown: true }}
    />
    <Stack.Screen
      name="PerformanceDashboard"
      component={PerformanceDashboardScreen}
      options={{ title: 'Performance', headerShown: true }}
    />
    <Stack.Screen
      name="ChurnPrediction"
      component={ChurnPredictionScreen}
      options={{ title: 'Churn Analytics', headerShown: true }}
    />
    <Stack.Screen
      name="UsageDashboard"
      component={UsageDashboardScreen}
      options={{ title: 'Usage Dashboard', headerShown: true }}
    />
    <Stack.Screen
      name="UsageAlerts"
      component={UsageAlertsScreen}
      options={{ title: 'Usage Alerts', headerShown: true }}
    />
    <Stack.Screen
      name="PaymentFailureList"
      component={PaymentFailureListScreen}
      options={{ title: 'Payment Failures', headerShown: true }}
    />
    <Stack.Screen
      name="PaymentFailureDetail"
      component={PaymentFailureDetailScreen}
      options={{ title: 'Failure Detail', headerShown: true }}
    />
  </Stack.Navigator>
);
