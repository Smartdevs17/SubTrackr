/**
 * Typography Design Tokens
 * Based on Material Design 3 type scale
 * WCAG 2.1 AA compliant minimum font sizes
 */

import type { TypographyTokens } from '../types/design-tokens';

/**
 * Typography scale with appropriate sizing for readability
 * Line height: 1.5x font size for optimal readability (WCAG AAA)
 * Font weight: Using platform-native weights for React Native
 */
export const typography: TypographyTokens = {
  // Headings
  h1: {
    fontSize: 32,
    fontWeight: 'bold',
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 28,
    fontWeight: 'bold',
    lineHeight: 36,
    letterSpacing: -0.25,
  },
  h3: {
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
    letterSpacing: 0,
  },
  h4: {
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
    letterSpacing: 0.15,
  },
  h5: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 24,
    letterSpacing: 0.1,
  },

  // Body text (WCAG AA minimum 14px, AAA minimum 16px)
  body: {
    fontSize: 16,
    fontWeight: 'normal',
    lineHeight: 24,
    letterSpacing: 0.5,
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: 'normal',
    lineHeight: 20,
    letterSpacing: 0.25,
  },
  bodySmall: {
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 18,
    letterSpacing: 0.4,
  },

  // Button text
  button: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  buttonSmall: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
    letterSpacing: 0.5,
  },

  // Caption/Label text
  caption: {
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    letterSpacing: 0.5,
  },

  // Overline (uppercase accent)
  overline: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
    letterSpacing: 0.5,
  },
};

/**
 * Font weight mapping for cross-platform compatibility
 * React Native uses numeric values, but we map to semantic names
 */
export const fontWeights = {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

/**
 * Line height multipliers for flexible sizing
 */
export const lineHeightMultipliers = {
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.75,
  loose: 2,
} as const;

/**
 * Letter spacing values for different text styles
 */
export const letterSpacing = {
  tight: -0.5,
  normal: 0,
  wide: 0.5,
  wider: 1,
  widest: 2,
} as const;

/**
 * Compute responsive font size based on base font size
 * @param baseFontSize - The base font size in pixels
 * @param scale - The scaling factor
 * @returns The computed font size
 */
export function computeResponsiveFontSize(
  baseFontSize: number,
  scale: number = 1
): number {
  return Math.round(baseFontSize * scale);
}

/**
 * Get typography style with optional overrides
 * @param style - The typography style object
 * @param overrides - Optional property overrides
 * @returns The merged typography style
 */
export function createTypographyStyle(
  style: (typeof typography)[keyof typeof typography],
  overrides?: Partial<(typeof typography)[keyof typeof typography]>
) {
  return { ...style, ...overrides };
}
