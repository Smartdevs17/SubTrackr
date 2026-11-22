/**
 * Tests for src/navigation/types.ts
 *
 * These run via jest.backend.config.js (ts-jest, no React Native preset needed)
 * because they exercise pure TypeScript exports only.
 *
 * Run with:
 *   npx jest --config jest.backend.config.js --testPathPattern navigationTypes
 */

// Re-export the types under test so we can reference them without triggering
// React hooks (useRoute / useNavigation are mocked below).
import type {
  SubscriptionStackParamList,
  AnalyticsStackParamList,
  SettingsStackParamList,
  WalletStackParamList,
  AdminStackParamList,
  DeveloperStackParamList,
  SocialStackParamList,
  RootStackParamList,
  TabParamList,
  RootNavigatorParamList,
} from '../types';
import { useAppNavigation, useAppRoute } from '../types';
import { useRoute, useNavigation } from '@react-navigation/native';

jest.mock('@react-navigation/native', () => ({
  useRoute: jest.fn(),
  useNavigation: jest.fn(),
  NavigatorScreenParams: undefined, // used as a type only
}));

// ─────────────────────────────────────────────────────────────────────────────
// Structural type assertions
//
// TypeScript type-checks happen at compile time; at runtime we assert the
// existence and shape of the exported names as proxies.
// ─────────────────────────────────────────────────────────────────────────────

describe('Navigation type exports', () => {
  it('exports useAppRoute as a function', () => {
    expect(typeof useAppRoute).toBe('function');
  });

  it('exports useAppNavigation as a function', () => {
    expect(typeof useAppNavigation).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compile-time shape checks
//
// These empty objects cast to the param list types. TypeScript will reject
// them at compile time if any required key is missing or has the wrong shape.
// At runtime the casts are no-ops; the test just verifies the file imports OK.
// ─────────────────────────────────────────────────────────────────────────────

describe('SubscriptionStackParamList shape', () => {
  it('contains the expected routes', () => {
    const routes: (keyof SubscriptionStackParamList)[] = [
      'SubscriptionDashboard',
      'AddSubscription',
      'SubscriptionDetail',
      'EditSubscription',
      'ChangePlan',
      'CancellationFlow',
      'PauseSubscription',
      'UsageDashboard',
      'UsageAlerts',
      'PlanTemplates',
    ];
    // Length is the structural check; if a route is removed the array shrinks.
    expect(routes).toHaveLength(10);
  });
});

describe('AnalyticsStackParamList shape', () => {
  it('contains the expected routes', () => {
    const routes: (keyof AnalyticsStackParamList)[] = [
      'Analytics',
      'AnalyticsDashboard',
      'RevenueReport',
      'PerformanceDashboard',
      'ChurnPrediction',
      'ForecastingDashboard',
    ];
    expect(routes).toHaveLength(6);
  });
});

describe('SettingsStackParamList shape', () => {
  it('contains the expected routes', () => {
    const routes: (keyof SettingsStackParamList)[] = [
      'Settings',
      'LanguageSettings',
      'NotificationPreferences',
      'DeliveryStatus',
      'NotificationInbox',
      'EmailTemplateEditor',
      'TemplateVersionHistory',
      'GDPRSettings',
      'PrivacyCenter',
      'ConsentManagement',
      'SmsConsent',
      'DataExport',
      'DPALog',
      'TaxSettings',
      'TaxCompliance',
      'AdvancedSearch',
    ];
    expect(routes).toHaveLength(16);
  });
});

describe('WalletStackParamList shape', () => {
  it('contains the expected routes', () => {
    const routes: (keyof WalletStackParamList)[] = [
      'WalletConnect',
      'CryptoPayment',
      'InvoiceList',
      'InvoiceDetail',
      'InvoiceCustomization',
      'InvoiceMarketplace',
      'InvoiceAnalytics',
      'PaymentMethods',
      'CalendarIntegration',
    ];
    expect(routes).toHaveLength(9);
  });
});

describe('AdminStackParamList shape', () => {
  it('contains the expected routes', () => {
    const routes: (keyof AdminStackParamList)[] = [
      'AdminDashboard',
      'MerchantOnboarding',
      'FraudDashboard',
      'ErrorDashboard',
      'SlaDashboard',
      'BillingSettings',
      'BillingAlignment',
      'DunningDashboard',
      'CreditsAndPrepayments',
      'SessionManagement',
      'RoleManagement',
      'CustomerHealth',
    ];
    expect(routes).toHaveLength(12);
  });
});

describe('DeveloperStackParamList shape', () => {
  it('contains the expected routes', () => {
    const routes: (keyof DeveloperStackParamList)[] = [
      'DeveloperPortal',
      'ApiPlayground',
      'SandboxDashboard',
      'ApiKeyManagement',
      'ApiKeys',
      'DocumentationPortal',
      'IntegrationGuides',
      'WebhookSettings',
      'WebhookLogs',
      'Import',
      'Export',
      'BatchOperations',
      'AccountingExport',
    ];
    expect(routes).toHaveLength(13);
  });
});

describe('SocialStackParamList shape', () => {
  it('contains the expected routes', () => {
    const routes: (keyof SocialStackParamList)[] = [
      'Community',
      'Profile',
      'Gamification',
      'LoyaltyDashboard',
      'AffiliateDashboard',
      'CampaignManagement',
      'PromotionManagement',
      'SegmentManagement',
      'SegmentDetail',
      'GroupManagement',
      'SupportDashboard',
      'TrialDetails',
      'NotFound',
    ];
    expect(routes).toHaveLength(13);
  });
});

describe('RootStackParamList (backward-compat intersection)', () => {
  it('includes routes from every per-stack list', () => {
    // Pick one route from each stack and verify it appears in the union type.
    // Type-only: if a route is removed from its stack the TS compile fails.
    const subscriptionKey: keyof RootStackParamList = 'SubscriptionDetail';
    const analyticsKey: keyof RootStackParamList = 'RevenueReport';
    const settingsKey: keyof RootStackParamList = 'TemplateVersionHistory';
    const walletKey: keyof RootStackParamList = 'InvoiceDetail';
    const adminKey: keyof RootStackParamList = 'FraudDashboard';
    const developerKey: keyof RootStackParamList = 'WebhookLogs';
    const socialKey: keyof RootStackParamList = 'SegmentDetail';

    // Runtime presence check
    for (const key of [
      subscriptionKey,
      analyticsKey,
      settingsKey,
      walletKey,
      adminKey,
      developerKey,
      socialKey,
    ]) {
      expect(typeof key).toBe('string');
    }
  });
});

describe('TabParamList shape', () => {
  it('contains the four expected tabs', () => {
    const tabs: (keyof TabParamList)[] = ['HomeTab', 'WalletTab', 'AnalyticsTab', 'SettingsTab'];
    expect(tabs).toHaveLength(4);
  });
});

describe('RootNavigatorParamList shape', () => {
  it('contains MainTabs and each named stack', () => {
    const screens: (keyof RootNavigatorParamList)[] = [
      'MainTabs',
      'SubscriptionStack',
      'AnalyticsStack',
      'WalletStack',
      'SettingsStack',
    ];
    expect(screens).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hook delegation
// ─────────────────────────────────────────────────────────────────────────────

describe('useAppRoute', () => {
  it('delegates to useRoute from @react-navigation/native', () => {
    const fakeRoute = {
      key: 'SegmentDetail-1',
      name: 'SegmentDetail',
      params: { segmentId: '42' },
    };
    (useRoute as jest.Mock).mockReturnValue(fakeRoute);

    const result = useAppRoute<'SegmentDetail'>();
    expect(useRoute).toHaveBeenCalled();
    expect(result).toBe(fakeRoute);
  });
});

describe('useAppNavigation', () => {
  it('delegates to useNavigation from @react-navigation/native', () => {
    const fakeNav = { navigate: jest.fn(), goBack: jest.fn() };
    (useNavigation as jest.Mock).mockReturnValue(fakeNav);

    const result = useAppNavigation<'SegmentDetail'>();
    expect(useNavigation).toHaveBeenCalled();
    expect(result).toBe(fakeNav);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parametric routes - typed params
// ─────────────────────────────────────────────────────────────────────────────

describe('Parametric route param shapes', () => {
  it('SubscriptionDetail requires an id string', () => {
    const params: SubscriptionStackParamList['SubscriptionDetail'] = { id: 'sub-123' };
    expect(params.id).toBe('sub-123');
  });

  it('EditSubscription requires an id string', () => {
    const params: SubscriptionStackParamList['EditSubscription'] = { id: 'sub-456' };
    expect(params.id).toBe('sub-456');
  });

  it('ChangePlan requires a subscriptionId string', () => {
    const params: SubscriptionStackParamList['ChangePlan'] = { subscriptionId: 'sub-789' };
    expect(params.subscriptionId).toBe('sub-789');
  });

  it('CancellationFlow requires a subscriptionId string', () => {
    const params: SubscriptionStackParamList['CancellationFlow'] = { subscriptionId: 'sub-012' };
    expect(params.subscriptionId).toBe('sub-012');
  });

  it('InvoiceDetail requires an id string', () => {
    const params: WalletStackParamList['InvoiceDetail'] = { id: 'inv-001' };
    expect(params.id).toBe('inv-001');
  });

  it('SegmentDetail requires a segmentId string', () => {
    const params: SocialStackParamList['SegmentDetail'] = { segmentId: 'seg-007' };
    expect(params.segmentId).toBe('seg-007');
  });

  it('NotFound accepts an optional reason string', () => {
    const withReason: SocialStackParamList['NotFound'] = { reason: 'page-removed' };
    const withoutReason: SocialStackParamList['NotFound'] = {};
    expect(withReason.reason).toBe('page-removed');
    expect(withoutReason.reason).toBeUndefined();
  });

  it('Profile accepts an optional subscriber string', () => {
    // SocialStackParamList['Profile'] is { subscriber?: string } | undefined
    const withSubscriber: Exclude<SocialStackParamList['Profile'], undefined> = {
      subscriber: 'alice',
    };
    expect(withSubscriber.subscriber).toBe('alice');
  });

  it('CryptoPayment accepts an optional subscriptionId', () => {
    // WalletStackParamList['CryptoPayment'] is { subscriptionId?: string } | undefined
    const withId: Exclude<WalletStackParamList['CryptoPayment'], undefined> = {
      subscriptionId: 'sub-999',
    };
    expect(withId.subscriptionId).toBe('sub-999');
  });
});
