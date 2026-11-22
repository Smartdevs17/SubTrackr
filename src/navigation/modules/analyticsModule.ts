import { lazyScreen } from '../../utils/lazyLoading';
import type { FeatureModuleDescriptor } from './types';

export const analyticsFeatureModule: FeatureModuleDescriptor = {
  key: 'analytics',
  title: 'Analytics',
  routes: ['AnalyticsTab', 'RevenueTab'],
  preload: [() => import('../../screens/AnalyticsScreen'), () => import('../../screens/RevenueReportScreen')],
};

export const AnalyticsScreen = lazyScreen(() => import('../../screens/AnalyticsScreen'));
export const RevenueReportScreen = lazyScreen(() => import('../../screens/RevenueReportScreen'));
