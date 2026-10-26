import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { lazyScreen } from '../../utils/lazyLoading';
import { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AdminDashboardScreen = lazyScreen(() => import('../../screens/AdminDashboardScreen'));
const MerchantOnboardingScreen = lazyScreen(() => import('../../screens/MerchantOnboardingScreen'));
const FraudDashboard = lazyScreen(() => import('../../screens/FraudDashboard'));
const ErrorDashboardScreen = lazyScreen(() => import('../../screens/ErrorDashboardScreen'));
const SlaDashboard = lazyScreen(() => import('../../screens/SlaDashboard'));
const BillingSettingsScreen = lazyScreen(() => import('../../screens/BillingSettingsScreen'));
const BillingAlignmentScreen = lazyScreen(() => import('../../screens/BillingAlignmentScreen'));
const DunningDashboardScreen = lazyScreen(() => import('../../screens/DunningDashboardScreen'));
const CreditsAndPrepaymentsScreen = lazyScreen(
  () => import('../../screens/CreditsAndPrepaymentsScreen')
);
const SessionManagementScreen = lazyScreen(() => import('../../screens/SessionManagementScreen'));
const RoleManagementScreen = lazyScreen(() => import('../../screens/RoleManagementScreen'));
const CustomerHealthScreen = lazyScreen(() => import('../../screens/CustomerHealthScreen'));

export const AdminStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="AdminDashboard"
      component={AdminDashboardScreen}
      options={{ title: 'Admin Dashboard', headerShown: true }}
    />
    <Stack.Screen
      name="MerchantOnboarding"
      component={MerchantOnboardingScreen}
      options={{ title: 'Merchant Onboarding', headerShown: true }}
    />
    <Stack.Screen
      name="FraudDashboard"
      component={FraudDashboard}
      options={{ title: 'Fraud Dashboard', headerShown: true }}
    />
    <Stack.Screen
      name="ErrorDashboard"
      component={ErrorDashboardScreen}
      options={{ title: 'Error Dashboard', headerShown: true }}
    />
    <Stack.Screen
      name="SlaDashboard"
      component={SlaDashboard}
      options={{ title: 'SLA Dashboard', headerShown: true }}
    />
    <Stack.Screen
      name="BillingSettings"
      component={BillingSettingsScreen}
      options={{ title: 'Billing Settings', headerShown: true }}
    />
    <Stack.Screen
      name="BillingAlignment"
      component={BillingAlignmentScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="DunningDashboard"
      component={DunningDashboardScreen}
      options={{ title: 'Dunning Dashboard', headerShown: true }}
    />
    <Stack.Screen
      name="CreditsAndPrepayments"
      component={CreditsAndPrepaymentsScreen}
      options={{ title: 'Credits & Prepayments', headerShown: true }}
    />
    <Stack.Screen
      name="SessionManagement"
      component={SessionManagementScreen}
      options={{ title: 'Sessions', headerShown: true }}
    />
    <Stack.Screen
      name="RoleManagement"
      component={RoleManagementScreen}
      options={{ title: 'Role Management', headerShown: true }}
    />
    <Stack.Screen
      name="CustomerHealth"
      component={CustomerHealthScreen}
      options={{ title: 'Customer Health', headerShown: true }}
    />
  </Stack.Navigator>
);
