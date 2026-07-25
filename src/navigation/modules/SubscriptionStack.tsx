import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { lazyScreen } from '../../utils/lazyLoading';
import { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AddSubscriptionScreen = lazyScreen(() => import('../../screens/AddSubscriptionScreen'));
const SubscriptionDetailScreen = lazyScreen(() => import('../../screens/SubscriptionDetailScreen'));
const EditSubscriptionScreen = lazyScreen(() => import('../../screens/EditSubscriptionScreen'));
const ChangePlanScreen = lazyScreen(() => import('../../screens/ChangePlanScreen'));
const CancellationFlowScreen = lazyScreen(() => import('../../screens/CancellationFlowScreen'));
const PauseSubscriptionScreen = lazyScreen(() => import('../../screens/PauseSubscriptionScreen'));
const UsageDashboardScreen = lazyScreen(() => import('../../screens/UsageDashboard'));

export const SubscriptionStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="AddSubscription"
      component={AddSubscriptionScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="SubscriptionDetail"
      component={SubscriptionDetailScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="EditSubscription"
      component={EditSubscriptionScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="ChangePlan"
      component={ChangePlanScreen}
      options={{ title: 'Change Plan', headerShown: true }}
    />
    <Stack.Screen
      name="CancellationFlow"
      component={CancellationFlowScreen}
      options={{ title: 'Cancel Subscription', headerShown: true }}
    />
    <Stack.Screen
      name="PauseSubscription"
      component={PauseSubscriptionScreen}
      options={{ title: 'Pause Subscription', headerShown: true }}
    />
    <Stack.Screen
      name="UsageDashboard"
      component={UsageDashboardScreen}
      options={{ headerShown: false }}
    />
  </Stack.Navigator>
);
