import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { OnboardingTour } from '../OnboardingTour';
import { useOnboardingStore } from '../../../store/onboardingStore';

describe('OnboardingTour Component', () => {
  beforeEach(() => {
    act(() => {
      useOnboardingStore.getState().resetTour();
    });
  });

  test('does not render when tour is inactive', () => {
    const { queryByTestId } = render(<OnboardingTour />);
    expect(queryByTestId('onboarding-tour-modal')).toBeNull();
  });

  test('renders step content when active', () => {
    act(() => {
      useOnboardingStore.getState().startTour();
    });

    const { getByTestId, getByText } = render(<OnboardingTour />);
    expect(getByTestId('onboarding-tour-modal')).toBeTruthy();
    expect(getByText('Welcome to SubTrackr!')).toBeTruthy();
    expect(getByText('Step 1 of 4')).toBeTruthy();
  });

  test('navigates to next step on button press', () => {
    act(() => {
      useOnboardingStore.getState().startTour();
    });

    const { getByTestId, getByText } = render(<OnboardingTour />);
    act(() => {
      fireEvent.press(getByTestId('onboarding-next-button'));
    });

    expect(useOnboardingStore.getState().currentStepIndex).toBe(1);
    expect(getByText('Step 2 of 4')).toBeTruthy();
    expect(getByText('Add Subscriptions')).toBeTruthy();
  });

  test('skips tour on skip button press', () => {
    act(() => {
      useOnboardingStore.getState().startTour();
    });

    const { getByTestId } = render(<OnboardingTour />);
    act(() => {
      fireEvent.press(getByTestId('onboarding-skip-button'));
    });

    expect(useOnboardingStore.getState().isActive).toBe(false);
    expect(useOnboardingStore.getState().isSkipped).toBe(true);
  });
});
