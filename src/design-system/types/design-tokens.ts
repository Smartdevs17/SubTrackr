/**
 * Design System Type Definitions
 * Provides comprehensive TypeScript support for the SubTrackr design system
 */

// ============================================================================
// THEME TYPES
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'high-contrast';

export interface ThemeColors {
  // Primary colors
  primary: string;
  primaryLight: string;
  primaryDark: string;
  onPrimary: string;

  // Secondary colors
  secondary: string;
  secondaryLight: string;
  secondaryDark: string;
  onSecondary: string;

  // Accent colors
  accent: string;
  accentLight: string;
  accentDark: string;
  onAccent: string;

  // Semantic colors
  success: string;
  successLight: string;
  successDark: string;
  onSuccess: string;

  warning: string;
  warningLight: string;
  warningDark: string;
  onWarning: string;

  error: string;
  errorLight: string;
  errorDark: string;
  onError: string;

  info: string;
  infoLight: string;
  infoDark: string;
  onInfo: string;

  // Surface colors
  background: string;
  surface: string;
  surfaceVariant: string;
  surfaceInverse: string;

  // Text colors
  text: string;
  textSecondary: string;
  textTertiary: string;
  textDisabled: string;

  // Other
  border: string;
  borderLight: string;
  divider: string;
  overlay: string;
  scrim: string;

  // Specialized backgrounds
  warningBackground: string;
  errorBackground: string;
  successBackground: string;
  infoBackground: string;
}

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: ThemeColors;
}

// ============================================================================
// SPACING TOKENS
// ============================================================================

export interface SpacingTokens {
  xs: number; // 4px
  sm: number; // 8px
  md: number; // 16px
  lg: number; // 24px
  xl: number; // 32px
  xxl: number; // 48px
}

// ============================================================================
// TYPOGRAPHY TOKENS
// ============================================================================

export interface TypographyStyle {
  fontSize: number;
  fontWeight: 'normal' | '500' | '600' | '700' | 'bold';
  lineHeight: number;
  letterSpacing?: number;
}

export interface TypographyTokens {
  h1: TypographyStyle;
  h2: TypographyStyle;
  h3: TypographyStyle;
  h4: TypographyStyle;
  h5: TypographyStyle;
  body: TypographyStyle;
  bodyMedium: TypographyStyle;
  bodySmall: TypographyStyle;
  button: TypographyStyle;
  buttonSmall: TypographyStyle;
  caption: TypographyStyle;
  label: TypographyStyle;
  overline: TypographyStyle;
}

// ============================================================================
// BORDER RADIUS TOKENS
// ============================================================================

export interface BorderRadiusTokens {
  none: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

// ============================================================================
// SHADOW TOKENS
// ============================================================================

export interface ShadowStyle {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export interface ShadowTokens {
  none: ShadowStyle;
  sm: ShadowStyle;
  md: ShadowStyle;
  lg: ShadowStyle;
  xl: ShadowStyle;
}

// ============================================================================
// ANIMATION TOKENS
// ============================================================================

export interface AnimationTokens {
  duration: {
    fastest: number;
    fast: number;
    normal: number;
    slow: number;
    slowest: number;
  };
  easing: {
    linear: string;
    easeIn: string;
    easeOut: string;
    easeInOut: string;
  };
}

// ============================================================================
// COMPLETE DESIGN SYSTEM
// ============================================================================

export interface DesignSystem {
  spacing: SpacingTokens;
  borderRadius: BorderRadiusTokens;
  typography: TypographyTokens;
  shadows: ShadowTokens;
  animation: AnimationTokens;
}

// ============================================================================
// COMPONENT PROP TYPES
// ============================================================================

export type ComponentSize = 'small' | 'medium' | 'large';
export type ComponentVariant = string; // Extended in individual components
export type ComponentState = 'default' | 'hover' | 'active' | 'disabled' | 'focused';

export interface BaseComponentProps {
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: string;
}

// ============================================================================
// ACCESSIBILITY TYPES
// ============================================================================

export interface AccessibilityProps {
  /**
   * Descriptive label for screen readers
   * WCAG 2.1 Level A requirement
   */
  accessibilityLabel: string;

  /**
   * Additional hint text for screen readers
   * WCAG 2.1 Level AAA recommendation
   */
  accessibilityHint?: string;

  /**
   * Accessibility role for semantics
   * WCAG 2.1 Level A requirement
   */
  accessibilityRole?:
    | 'button'
    | 'link'
    | 'tab'
    | 'checkbox'
    | 'radio'
    | 'switch'
    | 'menuitem'
    | 'header'
    | 'alert'
    | 'none'
    | 'summary'
    | 'image'
    | 'menu'
    | 'menubar'
    | 'dialog'
    | 'presentation';

  /**
   * Additional state information for accessibility
   */
  accessibilityState?: {
    disabled?: boolean;
    selected?: boolean;
    checked?: boolean | 'mixed';
    expanded?: boolean;
    busy?: boolean;
  };

  /**
   * Test ID for automated testing
   */
  testID?: string;
}

// ============================================================================
// PLATFORM-SPECIFIC TYPES
// ============================================================================

export type Platform = 'ios' | 'android' | 'web';

export interface PlatformSpecificStyle {
  ios?: Record<string, any>;
  android?: Record<string, any>;
  web?: Record<string, any>;
  default?: Record<string, any>;
}

// ============================================================================
// RTL SUPPORT TYPES
// ============================================================================

export interface DirectionalProperties {
  start?: number | string;
  end?: number | string;
  left?: number | string;
  right?: number | string;
}

export type DirectionType = 'ltr' | 'rtl';
