import { lazyScreen } from '../../utils/lazyLoading';
import type { FeatureModuleDescriptor } from './types';

export const homeFeatureModule: FeatureModuleDescriptor = {
  key: 'home',
  title: 'Home',
  routes: ['Home', 'SubscriptionDetail', 'EditSubscription', 'ChangePlan', 'NotFound'],
  preload: [
    () => import('../../screens/SubscriptionDetailScreen'),
    () => import('../../screens/AddSubscriptionScreen'),
  ],
};

export const HomeScreen = require('../../screens/HomeScreen').default;
export const AddSubscriptionScreen = lazyScreen(() => import('../../screens/AddSubscriptionScreen'));
export const CancellationFlowScreen = lazyScreen(() => import('../../screens/CancellationFlowScreen'));
export const WalletConnectScreen = lazyScreen(() => import('../../screens/WalletConnectV2Screen'));
export const CryptoPaymentScreen = lazyScreen(() => import('../../screens/CryptoPaymentScreen'));
export const CommunityScreen = lazyScreen(() => import('../../screens/CommunityScreen'));
export const ProfileScreen = lazyScreen(() => import('../../screens/ProfileScreen'));
export const SubscriptionDetailScreen = lazyScreen(() => import('../../screens/SubscriptionDetailScreen'));
export const InvoiceListScreen = lazyScreen(() => import('../../screens/InvoiceListScreen'));
export const InvoiceDetailScreen = lazyScreen(() => import('../../screens/InvoiceDetailScreen'));
export const SlaDashboard = lazyScreen(() => import('../../screens/SlaDashboard'));
export const SegmentManagementScreen = lazyScreen(() =>
  import('../../screens/SegmentManagementScreen').then((m) => ({ default: m.SegmentManagementScreen })),
);
export const SegmentDetailScreen = lazyScreen(() =>
  import('../../screens/SegmentDetailScreen').then((m) => ({ default: m.SegmentDetailScreen })),
);
export const GamificationScreen = lazyScreen(() =>
  import('../../screens/GamificationScreen').then((m) => ({ default: m.GamificationScreen })),
);
export const GroupManagementScreen = lazyScreen(() => import('../../screens/GroupManagementScreen'));
export const SupportDashboardScreen = lazyScreen(() => import('../../screens/SupportDashboardScreen'));
export const UsageDashboardScreen = lazyScreen(() => import('../../screens/UsageDashboard'));
export const EditSubscriptionScreen = lazyScreen(() => import('../../screens/EditSubscriptionScreen'));
export const ChangePlanScreen = lazyScreen(() => import('../../screens/ChangePlanScreen'));
export const NotFoundScreen = lazyScreen(() => import('../../screens/NotFoundScreen'));
