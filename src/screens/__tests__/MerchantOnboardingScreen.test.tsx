import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import MerchantOnboardingScreen from '../MerchantOnboardingScreen';

jest.mock('../../store/merchantStore', () => {
  const mockState = {
    onboarding: null,
    isLoading: false,
    error: null,
    startOnboarding: jest.fn().mockResolvedValue(undefined),
    nextStep: jest.fn().mockResolvedValue(undefined),
    previousStep: jest.fn().mockResolvedValue(undefined),
    requestVerification: jest.fn().mockResolvedValue(undefined),
    uploadDocument: jest.fn().mockResolvedValue(undefined),
    addNotification: jest.fn(),
    getUnreadNotificationCount: jest.fn().mockReturnValue(0),
    getOnboardingAnalytics: jest.fn().mockReturnValue({
      totalStarted: 0,
      totalCompleted: 0,
      totalRejected: 0,
      completionRate: 0,
      averageTimeToComplete: 0,
      dropOffByStep: {},
      documentRejectionRate: 0,
      averageVerificationTime: 0,
    }),
  };

  return {
    useMerchantStore: jest.fn(() => mockState),
  };
});

describe('MerchantOnboardingScreen', () => {
  it('renders start card when onboarding has not started', () => {
    const { getByText } = render(<MerchantOnboardingScreen />);
    expect(getByText('Merchant Onboarding')).toBeTruthy();
    expect(getByText('Start Onboarding')).toBeTruthy();
  });
});
