/**
 * Shadow Design Tokens
 * Platform-aware shadows for iOS, Android, and Web
 * Uses elevation for Android and shadow properties for iOS/Web
 */

import type { ShadowStyle, ShadowTokens } from '../types/design-tokens';

/**
 * Shadow system with elevation levels
 * Following Material Design 3 elevation system
 * Each level has iOS shadow properties and Android elevation
 */
export const shadows: ShadowTokens = {
  // No shadow (flat design)
  none: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },

  // Elevation 1 (small interactive elements)
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },

  // Elevation 4 (components, modals)
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },

  // Elevation 8 (floating elements, cards)
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },

  // Elevation 16 (overlays, modals, floating menus)
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.25,
    shadowRadius: 30,
    elevation: 16,
  },
};

/**
 * Shadow presets for common use cases
 */
export const shadowPresets = {
  card: shadows.md,
  button: shadows.sm,
  modal: shadows.xl,
  toast: shadows.lg,
  floating: shadows.lg,
  hover: shadows.lg,
  overlay: shadows.xl,
  dropdown: shadows.lg,
} as const;

/**
 * Get shadow value dynamically
 * @param level - The shadow level key
 * @returns The shadow style object
 */
export function getShadow(level: keyof typeof shadows): ShadowStyle {
  return shadows[level];
}

/**
 * Get shadow for a specific component
 * @param componentType - The component type
 * @returns The shadow style object
 */
export function getComponentShadow(
  componentType: keyof typeof shadowPresets
): ShadowStyle {
  return shadowPresets[componentType];
}

/**
 * Create custom shadow for specific use cases
 * @param elevation - Material Design elevation level (0-24)
 * @param isDark - Whether the theme is dark
 * @returns The custom shadow style
 */
export function createCustomShadow(
  elevation: number,
  isDark: boolean = false
): ShadowStyle {
  const opacity = isDark ? 0.15 : 0.1;
  const offset = Math.round(elevation * 1.25);

  return {
    shadowColor: isDark ? '#000' : '#000',
    shadowOffset: { width: 0, height: offset },
    shadowOpacity: opacity * (elevation / 4),
    shadowRadius: elevation * 2,
    elevation: Math.min(elevation, 24), // Android max elevation
  };
}
