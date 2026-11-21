/**
 * Tests for src/navigation/navigationRef.ts
 *
 * Run with:
 *   npx jest --config jest.backend.config.js --testPathPattern navigationRef
 */

import { createNavigationContainerRef } from '@react-navigation/native';
import {
  navigationRef,
  navigateTab,
  navigateSubscription,
  navigateSettings,
  navigateWallet,
  navigateAnalytics,
  navigateHomeScreen,
  navigateSettingsScreen,
} from '../navigationRef';

jest.mock('@react-navigation/native', () => ({
  createNavigationContainerRef: jest.fn(() => ({
    isReady: jest.fn(),
    navigate: jest.fn(),
  })),
}));

// Grab the mocked ref instance so we can configure it per test.
const ref = navigationRef as unknown as { isReady: jest.Mock; navigate: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('navigationRef creation', () => {
  it('is created via createNavigationContainerRef', () => {
    expect(createNavigationContainerRef).toHaveBeenCalledTimes(1);
  });
});

describe('navigateTab', () => {
  it('calls navigate when ref is ready', () => {
    ref.isReady.mockReturnValue(true);
    navigateTab('SettingsTab');
    expect(ref.navigate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when ref is not ready', () => {
    ref.isReady.mockReturnValue(false);
    navigateTab('HomeTab');
    expect(ref.navigate).not.toHaveBeenCalled();
  });
});

describe('navigateSubscription', () => {
  it('calls navigate into MainTabs > HomeTab when ready', () => {
    ref.isReady.mockReturnValue(true);
    navigateSubscription('SubscriptionDetail', { id: 'sub-1' });
    expect(ref.navigate).toHaveBeenCalledTimes(1);
    const [name, params] = ref.navigate.mock.calls[0];
    expect(name).toBe('MainTabs');
    expect(params.screen).toBe('HomeTab');
  });

  it('does nothing when ref is not ready', () => {
    ref.isReady.mockReturnValue(false);
    navigateSubscription('AddSubscription', undefined);
    expect(ref.navigate).not.toHaveBeenCalled();
  });
});

describe('navigateSettings', () => {
  it('calls navigate into MainTabs > SettingsTab when ready', () => {
    ref.isReady.mockReturnValue(true);
    navigateSettings('Settings', undefined);
    expect(ref.navigate).toHaveBeenCalledTimes(1);
    const [name, params] = ref.navigate.mock.calls[0];
    expect(name).toBe('MainTabs');
    expect(params.screen).toBe('SettingsTab');
  });

  it('passes nested screen params', () => {
    ref.isReady.mockReturnValue(true);
    navigateSettings('SmsConsent', { userId: 'u-42' });
    const [, params] = ref.navigate.mock.calls[0];
    expect(params.params.screen).toBe('SmsConsent');
    expect(params.params.params).toEqual({ userId: 'u-42' });
  });
});

describe('navigateWallet', () => {
  it('calls navigate into MainTabs > WalletTab when ready', () => {
    ref.isReady.mockReturnValue(true);
    navigateWallet('InvoiceDetail', { id: 'inv-7' });
    expect(ref.navigate).toHaveBeenCalledTimes(1);
    const [name, params] = ref.navigate.mock.calls[0];
    expect(name).toBe('MainTabs');
    expect(params.screen).toBe('WalletTab');
  });
});

describe('navigateAnalytics', () => {
  it('calls navigate into MainTabs > AnalyticsTab when ready', () => {
    ref.isReady.mockReturnValue(true);
    navigateAnalytics('RevenueReport', undefined);
    expect(ref.navigate).toHaveBeenCalledTimes(1);
    const [name, params] = ref.navigate.mock.calls[0];
    expect(name).toBe('MainTabs');
    expect(params.screen).toBe('AnalyticsTab');
  });
});

describe('backward-compat aliases', () => {
  it('navigateHomeScreen is the same function as navigateSubscription', () => {
    expect(navigateHomeScreen).toBe(navigateSubscription);
  });

  it('navigateSettingsScreen is the same function as navigateSettings', () => {
    expect(navigateSettingsScreen).toBe(navigateSettings);
  });
});
