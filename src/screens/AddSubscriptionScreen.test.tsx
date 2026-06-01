import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import AddSubscriptionScreen from './AddSubscriptionScreen';
import { useSubscriptionStore, useSettingsStore } from '../store';

// Navigation is mocked so the screen can be rendered in isolation without a
// real navigator. requireActual keeps the rest of the package intact.
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    goBack: mockGoBack,
    navigate: mockNavigate,
  }),
}));

// The store hooks are mocked so each test controls the exact state the screen
// reads, and we can assert on the addSubscription action.
jest.mock('../store', () => ({
  useSubscriptionStore: jest.fn(),
  useSettingsStore: jest.fn(),
}));

// errorHandler turns thrown validation Errors into a user-facing message.
jest.mock('../services/errorHandler', () => ({
  errorHandler: {
    handleError: (error: Error) => ({ userMessage: error.message }),
  },
}));

// The native date picker is never opened in these tests; stub it so importing
// the screen does not pull in the native module.
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const mockAddSubscription = jest.fn();

describe('AddSubscriptionScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (useSubscriptionStore as unknown as jest.Mock).mockReturnValue({
      addSubscription: mockAddSubscription,
      isLoading: false,
      error: null,
    });
    (useSettingsStore as unknown as jest.Mock).mockReturnValue({
      preferredCurrency: 'USD',
    });
  });

  describe('form validation', () => {
    it('shows a validation error and does not submit when the name is empty', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      render(<AddSubscriptionScreen />);

      fireEvent.press(screen.getByTestId('save-subscription-button'));

      expect(alertSpy).toHaveBeenCalledWith('Validation Error', 'Subscription name is required');
      expect(mockAddSubscription).not.toHaveBeenCalled();
    });

    it('shows an inline error when the price is not a valid number', () => {
      render(<AddSubscriptionScreen />);

      fireEvent.changeText(screen.getByTestId('subscription-price-input'), 'abc');

      expect(screen.getByText('Price must be a valid number')).toBeTruthy();
    });

    it('does not submit when the name is provided but the price is missing', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      render(<AddSubscriptionScreen />);

      fireEvent.changeText(screen.getByTestId('subscription-name-input'), 'Netflix');
      fireEvent.press(screen.getByTestId('save-subscription-button'));

      expect(alertSpy).toHaveBeenCalledWith('Validation Error', expect.stringMatching(/price/i));
      expect(mockAddSubscription).not.toHaveBeenCalled();
    });
  });

  describe('successful submission', () => {
    it('calls addSubscription with the entered data when the form is valid', async () => {
      mockAddSubscription.mockResolvedValueOnce(undefined);
      render(<AddSubscriptionScreen />);

      fireEvent.changeText(screen.getByTestId('subscription-name-input'), 'Netflix');
      fireEvent.changeText(screen.getByTestId('subscription-price-input'), '15.99');
      fireEvent.press(screen.getByTestId('save-subscription-button'));

      await waitFor(() => {
        expect(mockAddSubscription).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Netflix',
            price: 15.99,
            currency: 'USD',
          })
        );
      });
    });
  });

  describe('navigation', () => {
    it('navigates back when cancel is pressed on an empty form', () => {
      render(<AddSubscriptionScreen />);

      fireEvent.press(screen.getByTestId('cancel-add-subscription-button'));

      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });

    it('asks to discard changes instead of navigating back when the form is dirty', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      render(<AddSubscriptionScreen />);

      fireEvent.changeText(screen.getByTestId('subscription-name-input'), 'Netflix');
      fireEvent.press(screen.getByTestId('cancel-add-subscription-button'));

      expect(alertSpy).toHaveBeenCalledWith(
        'Discard Changes',
        expect.any(String),
        expect.any(Array)
      );
      expect(mockGoBack).not.toHaveBeenCalled();
    });
  });
});
