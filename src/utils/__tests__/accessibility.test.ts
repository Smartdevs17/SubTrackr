/**
 * Accessibility Test Utilities for React Native
 *
 * This file provides utilities for testing accessibility in React Native components.
 * Since jest-axe is designed for web (React DOM), we use React Native Testing Library
 * with custom accessibility checks.
 */

import { render, RenderAPI } from '@testing-library/react-native';

/**
 * Accessibility test result
 */
export interface AccessibilityTestResult {
  passed: boolean;
  violations: AccessibilityViolation[];
}

/**
 * Accessibility violation
 */
export interface AccessibilityViolation {
  id: string;
  description: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  element?: string;
}

/**
 * Check if a component has proper accessibility labels
 */
export function checkAccessibilityLabels(rendered: RenderAPI): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  // Check all touchable elements
  const touchables = rendered.getAllByRole('button');

  touchables.forEach((element) => {
    const props = element.props;

    // Check for accessibilityLabel
    if (!props.accessibilityLabel && !props.accessibilityLabelledBy) {
      violations.push({
        id: 'missing-accessibility-label',
        description: 'Touchable element missing accessibilityLabel',
        impact: 'serious',
        element: element.type?.toString() || 'Unknown',
      });
    }

    // Check for accessibilityRole
    if (!props.accessibilityRole) {
      violations.push({
        id: 'missing-accessibility-role',
        description: 'Touchable element missing accessibilityRole',
        impact: 'moderate',
        element: element.type?.toString() || 'Unknown',
      });
    }
  });

  return violations;
}

/**
 * Check if text elements have proper contrast (simulated check)
 * Note: Actual contrast checking requires color extraction which is complex in React Native tests
 */
export function checkTextContrast(rendered: RenderAPI): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  // This is a placeholder - actual contrast checking would require
  // extracting computed styles from the rendered component
  // For now, we just check that text elements exist

  const textElements = rendered.getAllByText(/./);

  if (textElements.length === 0) {
    violations.push({
      id: 'no-text-found',
      description: 'No text elements found in component',
      impact: 'minor',
    });
  }

  return violations;
}

/**
 * Check for proper accessibility hints where needed
 */
export function checkAccessibilityHints(rendered: RenderAPI): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  // Check elements that might need hints (complex interactions)
  const touchables = rendered.getAllByRole('button');

  touchables.forEach((element) => {
    const props = element.props;

    // Elements with complex interactions should have hints
    if (props.onLongPress && !props.accessibilityHint) {
      violations.push({
        id: 'missing-accessibility-hint',
        description: 'Element with long press missing accessibilityHint',
        impact: 'moderate',
        element: element.type?.toString() || 'Unknown',
      });
    }
  });

  return violations;
}

/**
 * Run all accessibility checks on a rendered component
 */
export function runAccessibilityChecks(rendered: RenderAPI): AccessibilityTestResult {
  const violations: AccessibilityViolation[] = [
    ...checkAccessibilityLabels(rendered),
    ...checkTextContrast(rendered),
    ...checkAccessibilityHints(rendered),
  ];

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Helper function to test component accessibility
 */
export function testComponentAccessibility(
  component: React.ReactElement,
  testName: string
): AccessibilityTestResult {
  const rendered = render(component);
  const result = runAccessibilityChecks(rendered);

  if (!result.passed) {
    console.warn(`Accessibility violations in ${testName}:`, result.violations);
  }

  return result;
}

/**
 * Expect no accessibility violations (for use in tests)
 */
export function expectNoAccessibilityViolations(result: AccessibilityTestResult) {
  if (!result.passed) {
    const message = result.violations.map((v) => `[${v.impact}] ${v.description}`).join('\n');
    throw new Error(`Accessibility violations found:\n${message}`);
  }
}
