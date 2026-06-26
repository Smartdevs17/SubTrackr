import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { FloatingActionButton } from './FloatingActionButton';

describe('FloatingActionButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls onPress once when the button is pressed', () => {
    const onPress = jest.fn();
    render(<FloatingActionButton onPress={onPress} testID="fab" />);

    fireEvent.press(screen.getByTestId('fab'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the provided icon and title', () => {
    render(<FloatingActionButton onPress={jest.fn()} icon="★" title="Add" />);

    expect(screen.getByText('★')).toBeTruthy();
    expect(screen.getByText('Add')).toBeTruthy();
  });

  it('uses the accessibility label when provided', () => {
    const onPress = jest.fn();
    render(<FloatingActionButton onPress={onPress} accessibilityLabel="Add subscription" />);

    fireEvent.press(screen.getByLabelText('Add subscription'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
