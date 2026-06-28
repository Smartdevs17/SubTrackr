/**
 * SubTrackr Design System - Main Export
 * Central hub for all design system tokens, components, and utilities
 *
 * Usage:
 * ```typescript
 * import {
 *   Button,
 *   Card,
 *   Input,
 *   typography,
 *   spacing,
 *   colors,
 *   darkTheme,
 * } from '@/design-system';
 * ```
 */

// ============================================================================
// TOKENS
// ============================================================================
export * from './tokens';

// ============================================================================
// TYPES
// ============================================================================
export type {
  Theme,
  ThemeMode,
  ThemeColors,
  SpacingTokens,
  TypographyTokens,
  BorderRadiusTokens,
  ShadowTokens,
  AnimationTokens,
  DesignSystem,
  AccessibilityProps,
  BaseComponentProps,
  Platform,
  DirectionType,
} from './types/design-tokens';

// ============================================================================
// COMPONENTS
// ============================================================================
export * from './components';

// ============================================================================
// UTILITIES
// ============================================================================
export * from './utils';
