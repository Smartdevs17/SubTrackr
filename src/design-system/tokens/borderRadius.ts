/**
 * Border Radius Design Tokens
 * For consistent rounded corners across all components
 */

import type { BorderRadiusTokens } from '../types/design-tokens';

/**
 * Border radius scale for components
 * Uses semantic sizing that scales from small to large
 */
export const borderRadius: BorderRadiusTokens = {
  none: 0, // Sharp corners (rarely used)
  sm: 4, // 0.25rem - Small radius (inputs, small components)
  md: 8, // 0.5rem - Medium radius (default for most components)
  lg: 12, // 0.75rem - Large radius (cards, modals)
  xl: 16, // 1rem - Extra large radius (large containers)
  full: 9999, // Circular/pill-shaped buttons
};

/**
 * Component-specific border radius overrides
 * Use these for consistent styling across component types
 */
export const componentBorderRadius = {
  button: borderRadius.md,
  buttonSmall: borderRadius.sm,
  buttonLarge: borderRadius.lg,
  input: borderRadius.md,
  card: borderRadius.lg,
  modal: borderRadius.xl,
  toast: borderRadius.lg,
  chip: borderRadius.full,
  avatar: borderRadius.full,
  image: borderRadius.lg,
  foldingCard: borderRadius.xl,
} as const;

/**
 * Get border radius value dynamically
 * @param scale - The border radius scale key
 * @returns The border radius value in pixels
 */
export function getBorderRadius(scale: keyof typeof borderRadius): number {
  return borderRadius[scale];
}

/**
 * Create a component with standard border radius
 * @param componentType - The component type to get radius for
 * @returns The border radius value
 */
export function getComponentBorderRadius(
  componentType: keyof typeof componentBorderRadius
): number {
  return componentBorderRadius[componentType];
}
