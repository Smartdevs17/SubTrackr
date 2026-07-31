import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { lazyScreen } from '../../utils/lazyLoading';
import { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const CommunityScreen = lazyScreen(() => import('../../screens/CommunityScreen'));
const ProfileScreen = lazyScreen(() => import('../../screens/ProfileScreen'));
const GamificationScreen = lazyScreen(() =>
  import('../../screens/GamificationScreen').then((m) => ({ default: m.GamificationScreen }))
);
const LoyaltyDashboardScreen = lazyScreen(() => import('../../screens/LoyaltyDashboardScreen'));
const AffiliateDashboardScreen = lazyScreen(() => import('../../screens/AffiliateDashboardScreen'));
const CampaignManagementScreen = lazyScreen(() => import('../../screens/CampaignManagementScreen'));
const PromotionManagementScreen = lazyScreen(
  () => import('../../screens/PromotionManagementScreen')
);
const SegmentManagementScreen = lazyScreen(() =>
  import('../../screens/SegmentManagementScreen').then((m) => ({
    default: m.SegmentManagementScreen,
  }))
);
const SegmentDetailScreen = lazyScreen(() =>
  import('../../screens/SegmentDetailScreen').then((m) => ({ default: m.SegmentDetailScreen }))
);
const GroupManagementScreen = lazyScreen(() => import('../../screens/GroupManagementScreen'));
const SupportDashboardScreen = lazyScreen(() => import('../../screens/SupportDashboardScreen'));
const TrialDetailsScreen = lazyScreen(() => import('../../screens/TrialDetailsScreen'));
// NotFoundScreen has no default export, so the named one is mapped onto the
// shape `lazyScreen` expects.
const NotFoundScreen = lazyScreen(() =>
  import('../../screens/NotFoundScreen').then((m) => ({ default: m.NotFoundScreen }))
);

export const SocialStack = () => (
  <Stack.Navigator>
    <Stack.Screen
      name="Community"
      component={CommunityScreen}
      options={{ title: 'Community', headerShown: true }}
    />
    <Stack.Screen
      name="Profile"
      component={ProfileScreen}
      options={{ title: 'Profile', headerShown: true }}
    />
    <Stack.Screen
      name="Gamification"
      component={GamificationScreen}
      options={{ title: 'Achievements', headerShown: true }}
    />
    <Stack.Screen
      name="LoyaltyDashboard"
      component={LoyaltyDashboardScreen}
      options={{ title: 'Loyalty', headerShown: true }}
    />
    <Stack.Screen
      name="AffiliateDashboard"
      component={AffiliateDashboardScreen}
      options={{ title: 'Affiliates', headerShown: true }}
    />
    <Stack.Screen
      name="CampaignManagement"
      component={CampaignManagementScreen}
      options={{ title: 'Campaigns', headerShown: true }}
    />
    <Stack.Screen
      name="PromotionManagement"
      component={PromotionManagementScreen}
      options={{ headerShown: false }}
    />
    <Stack.Screen
      name="SegmentManagement"
      component={SegmentManagementScreen}
      options={{ title: 'Segments', headerShown: true }}
    />
    <Stack.Screen
      name="SegmentDetail"
      component={SegmentDetailScreen}
      options={{ title: 'Segment Detail', headerShown: true }}
    />
    <Stack.Screen
      name="GroupManagement"
      component={GroupManagementScreen}
      options={{ title: 'Groups', headerShown: true }}
    />
    <Stack.Screen
      name="SupportDashboard"
      component={SupportDashboardScreen}
      options={{ title: 'Support', headerShown: true }}
    />
    <Stack.Screen
      name="TrialDetails"
      component={TrialDetailsScreen}
      options={{ title: 'Trial Details', headerShown: true }}
    />
    <Stack.Screen
      name="NotFound"
      component={NotFoundScreen}
      options={{ title: 'Not Found', headerShown: true }}
    />
  </Stack.Navigator>
);
