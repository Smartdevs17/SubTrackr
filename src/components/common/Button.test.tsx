import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Button } from './Button';
import { ThemeProvider } from '../../context/ThemeContext';

describe('Button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('press interactions', () => {
    it('calls the onPress callback once when the button is pressed', () => {
      const onPress = jest.fn();
      render(
        <ThemeProvider>
          <Button title="Save" onPress={onPress} />
        </ThemeProvider>
      );

      fireEvent.press(screen.getByText('Save'));

      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('does not call onPress when the button is disabled', () => {
      const onPress = jest.fn();
      render(
        <ThemeProvider>
          <Button title="Save" onPress={onPress} disabled />
        </ThemeProvider>
      );

      fireEvent.press(screen.getByText('Save'));

      expect(onPress).not.toHaveBeenCalled();
    });

    it('does not call onPress while the button is loading', () => {
      const onPress = jest.fn();
      render(
        <ThemeProvider>
          <Button title="Save" onPress={onPress} loading />
        </ThemeProvider>
      );

      // While loading the label is replaced by a spinner, so query by role.
      fireEvent.press(screen.getByRole('button'));

      expect(onPress).not.toHaveBeenCalled();
    });
  });

  describe('accessibility state', () => {
    it('exposes a disabled accessibility state when disabled', () => {
      render(
        <ThemeProvider>
          <Button title="Save" onPress={jest.fn()} disabled />
        </ThemeProvider>
      );

      const button = screen.getByRole('button');

      expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('marks the button as busy while loading', () => {
      render(
        <ThemeProvider>
          <Button title="Save" onPress={jest.fn()} loading />
        </ThemeProvider>
      );

      const button = screen.getByRole('button');

      expect(button.props.accessibilityState).toMatchObject({ busy: true });
    });
  });
});
