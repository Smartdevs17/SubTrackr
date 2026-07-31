import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent } from '../../test-utils';
import { SubscriptionCard } from './SubscriptionCard';
import { mockSubscription, mockPausedSubscription } from '../../__fixtures__/subscriptions';

// SubscriptionCard reads the settings store, which persists through AsyncStorage.
// The native module is unavailable under Jest, so use the library's official mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('SubscriptionCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('press interactions', () => {
    it('calls onPress with the full subscription when the card is pressed', () => {
      const onPress = jest.fn();
      render(<SubscriptionCard subscription={mockSubscription} onPress={onPress} />);

      fireEvent.press(screen.getByTestId(`subscription-card-${mockSubscription.id}`));

      expect(onPress).toHaveBeenCalledTimes(1);
      expect(onPress).toHaveBeenCalledWith(mockSubscription);
    });

    it('renders the subscription name', () => {
      render(<SubscriptionCard subscription={mockSubscription} onPress={jest.fn()} />);

      expect(screen.getByTestId(`subscription-name-${mockSubscription.id}`)).toHaveTextContent(
        'Netflix'
      );
    });
  });

  describe('status toggle interactions', () => {
    it('does not render the toggle button when onToggleStatus is omitted', () => {
      render(<SubscriptionCard subscription={mockSubscription} onPress={jest.fn()} />);

      expect(screen.queryByTestId(`subscription-toggle-${mockSubscription.id}`)).toBeNull();
    });

    it('prompts for confirmation and calls onToggleStatus when confirmed', () => {
      const onToggleStatus = jest.fn();
      const alertSpy = jest.spyOn(Alert, 'alert');
      render(
        <SubscriptionCard
          subscription={mockSubscription}
          onPress={jest.fn()}
          onToggleStatus={onToggleStatus}
        />
      );

      fireEvent.press(screen.getByTestId(`subscription-toggle-${mockSubscription.id}`));

      // A confirmation dialog is shown before the status changes.
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(onToggleStatus).not.toHaveBeenCalled();

      // Simulate the user tapping "Confirm" in the alert.
      const buttons = alertSpy.mock.calls[0][2] ?? [];
      const confirm = buttons.find((button) => button.text === 'Confirm');
      confirm?.onPress?.();

      expect(onToggleStatus).toHaveBeenCalledWith(mockSubscription.id);
    });

    it('labels the toggle "Activate" for a paused subscription', () => {
      render(
        <SubscriptionCard
          subscription={mockPausedSubscription}
          onPress={jest.fn()}
          onToggleStatus={jest.fn()}
        />
      );

      expect(
        screen.getByTestId(`subscription-toggle-${mockPausedSubscription.id}`)
      ).toHaveTextContent('Activate');
    });
  });
});
