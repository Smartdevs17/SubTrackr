import { lazyScreen } from '../../utils/lazyLoading';
import type { FeatureModuleDescriptor } from './types';

export const developerFeatureModule: FeatureModuleDescriptor = {
  key: 'developer',
  title: 'Developer',
  routes: ['DeveloperPortal', 'SandboxDashboard', 'ApiKeyManagement', 'DocumentationPortal', 'IntegrationGuides'],
};

export const DeveloperPortalScreen = lazyScreen(() => import('../../screens/DeveloperPortalScreen'));
export const SandboxDashboardScreen = lazyScreen(() => import('../../screens/SandboxDashboardScreen'));
export const ApiKeyManagementScreen = lazyScreen(() => import('../../screens/ApiKeyManagementScreen'));
export const DocumentationPortalScreen = lazyScreen(() => import('../../screens/DocumentationPortalScreen'));
export const IntegrationGuidesScreen = lazyScreen(() => import('../../screens/IntegrationGuidesScreen'));
