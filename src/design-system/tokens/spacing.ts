/**
 * Spacing Design Tokens
 * 8-point spacing scale for consistency and scalability
 */

import type { SpacingTokens } from '../types/design-tokens';

/**
 * 8-point grid system for responsive and scalable layouts
 * Used for margins, padding, and gap values
 */
export const spacing: SpacingTokens = {
  // Base unit: 4px (half-step)
  xs: 4, // 0.25rem - Extra small spacing (micro-interactions)

  // Primary scale: 8px increments
  sm: 8, // 0.5rem - Small spacing
  md: 16, // 1rem - Medium spacing (default)
  lg: 24, // 1.5rem - Large spacing
  xl: 32, // 2rem - Extra large spacing
  xxl: 48, // 3rem - 2x large spacing (section spacing)
};

/**
 * Computed spacing values for quick reference
 * Useful for complex calculations
 */
export const spacingComputed = {
  // Double spacing
  smDouble: spacing.sm * 2, // 16px
  mdDouble: spacing.md * 2, // 32px
  lgDouble: spacing.lg * 2, // 48px
  xlDouble: spacing.xl * 2, // 64px

  // Half spacing (useful for fine-tuning)
  smHalf: spacing.sm / 2, // 4px
  mdHalf: spacing.md / 2, // 8px
  lgHalf: spacing.lg / 2, // 12px
  xlHalf: spacing.xl / 2, // 16px

  // Third spacing (for specific layouts)
  smThird: spacing.sm / 3, // 2.67px
  mdThird: spacing.md / 3, // 5.33px
  lgThird: spacing.lg / 3, // 8px
};

/**
 * Spacing scale options for margin and padding helpers
 */
export type SpacingValue = keyof typeof spacing;

/**
 * Get spacing value dynamically
 * @param scale - The spacing scale key
 * @returns The spacing value in pixels
 */
export function getSpacing(scale: SpacingValue): number {
  return spacing[scale];
}

/**
 * Get multiple spacing values for shorthand CSS
 * @param horizontal - Horizontal spacing
 * @param vertical - Vertical spacing
 * @returns Array of spacing values
 */
export function getSpacingPair(horizontal: SpacingValue, vertical: SpacingValue): [number, number] {
  return [spacing[horizontal], spacing[vertical]];
}
