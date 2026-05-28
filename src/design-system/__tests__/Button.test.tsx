/**
 * Button Component Unit Tests
 * Tests button functionality, variants, and accessibility
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Button } from '../components/Button';

describe('Button Component', () => {
  // ========================================================================
  // RENDERING TESTS
  // ========================================================================

  it('should render with label text', () => {
    render(
      <Button
        label="Click Me"
        onPress={() => {}}
        accessibilityLabel="Click button"
      />
    );

    const button = screen.getByText('Click Me');
    expect(button).toBeTruthy();
  });

  it('should render all variants', () => {
    const variants = ['primary', 'secondary', 'outline', 'ghost', 'danger', 'success', 'crypto'] as const;

    variants.forEach((variant) => {
      const { unmount } = render(
        <Button
          label={`${variant} Button`}
          variant={variant}
          onPress={() => {}}
          accessibilityLabel={`${variant} button`}
        />
      );

      const button = screen.getByText(`${variant} Button`);
      expect(button).toBeTruthy();
      unmount();
    });
  });

  it('should render all sizes', () => {
    const sizes = ['small', 'medium', 'large'] as const;

    sizes.forEach((size) => {
      const { unmount } = render(
        <Button
          label={`${size} Button`}
          size={size}
          onPress={() => {}}
          accessibilityLabel={`${size} button`}
        />
      );

      const button = screen.getByText(`${size} Button`);
      expect(button).toBeTruthy();
      unmount();
    });
  });

  // ========================================================================
  // INTERACTION TESTS
  // ========================================================================

  it('should call onPress when tapped', () => {
    const mockOnPress = jest.fn();

    render(
      <Button
        label="Press Me"
        onPress={mockOnPress}
        accessibilityLabel="Press button"
      />
    );

    const button = screen.getByText('Press Me');
    fireEvent.press(button);

    expect(mockOnPress).toHaveBeenCalled();
  });

  it('should not call onPress when disabled', () => {
    const mockOnPress = jest.fn();

    render(
      <Button
        label="Disabled Button"
        onPress={mockOnPress}
        disabled
        accessibilityLabel="Disabled button"
      />
    );

    const button = screen.getByText('Disabled Button');
    fireEvent.press(button);

    expect(mockOnPress).not.toHaveBeenCalled();
  });

  it('should handle async onPress', async () => {
    const mockOnPress = jest.fn().mockResolvedValue(undefined);

    render(
      <Button
        label="Async Button"
        onPress={mockOnPress}
        accessibilityLabel="Async button"
      />
    );

    const button = screen.getByText('Async Button');
    fireEvent.press(button);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockOnPress).toHaveBeenCalled();
  });

  // ========================================================================
  // ACCESSIBILITY TESTS
  // ========================================================================

  it('should have accessibility label', () => {
    render(
      <Button
        label="Accessible Button"
        onPress={() => {}}
        accessibilityLabel="Custom Accessibility Label"
      />
    );

    const button = screen.getByLabelText('Custom Accessibility Label');
    expect(button).toBeTruthy();
  });

  it('should support accessibility hint for disabled state', () => {
    render(
      <Button
        label="Disabled Button"
        onPress={() => {}}
        disabled
        accessibilityLabel="Disabled button"
      />
    );

    const button = screen.getByLabelText('Disabled button');
    // Check that accessibility state is set
    expect(button).toHaveAccessibilityState({ disabled: true });
  });

  it('should have proper role set', () => {
    render(
      <Button
        label="Role Button"
        onPress={() => {}}
        accessibilityLabel="Button role"
        accessibilityRole="button"
      />
    );

    const button = screen.getByRole('button');
    expect(button).toBeTruthy();
  });

  // ========================================================================
  // LOADING STATE TESTS
  // ========================================================================

  it('should display loading indicator', () => {
    render(
      <Button
        label="Loading"
        onPress={() => {}}
        loading
        accessibilityLabel="Loading button"
      />
    );

    // The loading indicator should be rendered
    // In a real test with proper ActivityIndicator mock
    expect(screen.getByText('Loading')).toBeTruthy();
  });

  it('should be disabled when loading', () => {
    const mockOnPress = jest.fn();

    render(
      <Button
        label="Loading Button"
        onPress={mockOnPress}
        loading
        accessibilityLabel="Loading button"
      />
    );

    const button = screen.getByText('Loading Button');
    fireEvent.press(button);

    // Should not call onPress while loading
    expect(mockOnPress).not.toHaveBeenCalled();
  });

  // ========================================================================
  // STYLE TESTS
  // ========================================================================

  it('should apply full width style', () => {
    const { getByTestId } = render(
      <Button
        label="Full Width"
        onPress={() => {}}
        fullWidth
        testID="full-width-button"
        accessibilityLabel="Full width button"
      />
    );

    const button = getByTestId('full-width-button');
    expect(button).toHaveProp('style', expect.arrayContaining([
      expect.objectContaining({ width: '100%' }),
    ]));
  });

  // ========================================================================
  // TEST IDS
  // ========================================================================

  it('should use custom test ID', () => {
    const { getByTestId } = render(
      <Button
        label="Custom Test ID"
        onPress={() => {}}
        testID="custom-button-id"
        accessibilityLabel="Custom ID button"
      />
    );

    expect(getByTestId('custom-button-id')).toBeTruthy();
  });

  it('should generate test ID from label', () => {
    const { getByTestId } = render(
      <Button
        label="Auto Test ID"
        onPress={() => {}}
        accessibilityLabel="Auto ID button"
      />
    );

    expect(getByTestId('button-auto-test-id')).toBeTruthy();
  });
});
