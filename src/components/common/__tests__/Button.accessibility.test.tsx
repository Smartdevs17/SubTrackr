/**
 * Accessibility Tests for Button Component
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Button } from '../Button';
import {
  runAccessibilityChecks,
  expectNoAccessibilityViolations,
} from '../../../utils/__tests__/accessibility.test';

describe('Button Accessibility', () => {
  it('should have no accessibility violations with minimal props', () => {
    const component = <Button title="Test Button" onPress={() => {}} />;
    const rendered = render(component);
    const result = runAccessibilityChecks(rendered);

    expectNoAccessibilityViolations(result);
  });

  it('should have accessibilityLabel when provided', () => {
    const component = (
      <Button title="Test Button" onPress={() => {}} accessibilityLabel="Custom button label" />
    );
    const rendered = render(component);
    const button = rendered.getByRole('button');

    expect(button.props.accessibilityLabel).toBe('Custom button label');
  });

  it('should have accessibilityHint when provided', () => {
    const component = (
      <Button title="Test Button" onPress={() => {}} accessibilityHint="This is a hint" />
    );
    const rendered = render(component);
    const button = rendered.getByRole('button');

    expect(button.props.accessibilityHint).toBe('This is a hint');
  });

  it('should have accessibilityRole set to button', () => {
    const component = <Button title="Test Button" onPress={() => {}} />;
    const rendered = render(component);
    const button = rendered.getByRole('button');

    expect(button.props.accessibilityRole).toBe('button');
  });

  it('should announce disabled state', () => {
    const component = <Button title="Test Button" onPress={() => {}} disabled />;
    const rendered = render(component);
    const button = rendered.getByRole('button');

    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('should announce loading state', () => {
    const component = <Button title="Test Button" onPress={() => {}} loading />;
    const rendered = render(component);
    const button = rendered.getByRole('button');

    expect(button.props.accessibilityState?.busy).toBe(true);
  });

  it('should support dynamic font scaling', () => {
    const component = <Button title="Test Button" onPress={() => {}} />;
    const rendered = render(component);
    const text = rendered.getByText('Test Button');

    expect(text.props.allowFontScaling).toBe(true);
    expect(text.props.maxFontSizeMultiplier).toBe(1.5);
  });
});
