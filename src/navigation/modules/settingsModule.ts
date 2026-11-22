import { lazyScreen } from '../../utils/lazyLoading';
import type { FeatureModuleDescriptor } from './types';

export const settingsFeatureModule: FeatureModuleDescriptor = {
  key: 'settings',
  title: 'Settings',
  routes: ['Settings', 'GDPRSettings', 'LanguageSettings', 'Import', 'Export'],
  preload: [() => import('../../screens/SettingsScreen')],
};

export const SettingsScreen = require('../../screens/SettingsScreen').SettingsScreen;
export const GDPRSettingsScreen = lazyScreen(() => import('../../screens/GDPRSettingsScreen'));
export const LanguageSettingsScreen = lazyScreen(() => import('../../screens/LanguageSettingsScreen'));
export const SessionManagementScreen = lazyScreen(() => import('../../screens/SessionManagementScreen'));
export const CalendarIntegrationScreen = lazyScreen(() => import('../../screens/CalendarIntegrationScreen'));
export const AccountingExportScreen = lazyScreen(() => import('../../screens/AccountingExportScreen'));
export const WebhookSettingsScreen = lazyScreen(() => import('../../screens/WebhookSettingsScreen'));
export const ErrorDashboardScreen = lazyScreen(() => import('../../screens/ErrorDashboardScreen'));
export const ImportScreen = lazyScreen(() => import('../../screens/ImportScreen'));
export const ExportScreen = lazyScreen(() => import('../../screens/ExportScreen'));
export const BatchOperationsScreen = lazyScreen(() =>
  import('../../../app/screens/BatchOperationsScreen').then((m) => ({ default: m.BatchOperationsScreen })),
);
export const AdminDashboardScreen = lazyScreen(() => import('../../screens/AdminDashboardScreen'));
export const FraudDashboard = lazyScreen(() => import('../../screens/FraudDashboard'));
export const TaxSettingsScreen = lazyScreen(() => import('../../screens/TaxSettingsScreen'));
export const MerchantOnboardingScreen = lazyScreen(() => import('../../screens/MerchantOnboardingScreen'));
export const AffiliateDashboardScreen = lazyScreen(() => import('../../screens/AffiliateDashboardScreen'));
export const LoyaltyDashboardScreen = lazyScreen(() => import('../../screens/LoyaltyDashboardScreen'));
export const CampaignManagementScreen = lazyScreen(() => import('../../screens/CampaignManagementScreen'));
export const PerformanceDashboardScreen = lazyScreen(() => import('../../screens/PerformanceDashboardScreen'));
export const BillingSettingsScreen = lazyScreen(() => import('../../screens/BillingSettingsScreen'));
export const PaymentMethodsScreen = lazyScreen(() =>
  import('../../../app/screens/PaymentMethodsScreen').then((m) => ({ default: m.PaymentMethodsScreen })),
);
export const AnalyticsDashboard = lazyScreen(() => import('../../../app/screens/AnalyticsDashboard'));
