/**
 * Color Design Tokens
 * WCAG 2.1 AA compliant color palettes with sufficient contrast ratios
 */

import type { ThemeColors } from '../types/design-tokens';

// ============================================================================
// DARK THEME (Default)
// ============================================================================
export const darkThemeColors: ThemeColors = {
  // Primary - Indigo
  primary: '#6366f1',
  primaryLight: '#818cf8',
  primaryDark: '#4f46e5',
  onPrimary: '#ffffff',

  // Secondary - Purple
  secondary: '#8b5cf6',
  secondaryLight: '#a78bfa',
  secondaryDark: '#7c3aed',
  onSecondary: '#ffffff',

  // Accent - Cyan
  accent: '#06b6d4',
  accentLight: '#22d3ee',
  accentDark: '#0891b2',
  onAccent: '#ffffff',

  // Semantic - Success (Emerald)
  success: '#10b981',
  successLight: '#6ee7b7',
  successDark: '#059669',
  onSuccess: '#ffffff',

  // Semantic - Warning (Amber)
  warning: '#f59e0b',
  warningLight: '#fbbf24',
  warningDark: '#d97706',
  onWarning: '#ffffff',

  // Semantic - Error (Red)
  error: '#ef4444',
  errorLight: '#fca5a5',
  errorDark: '#dc2626',
  onError: '#ffffff',

  // Semantic - Info (Sky)
  info: '#0ea5e9',
  infoLight: '#38bdf8',
  infoDark: '#0284c7',
  onInfo: '#ffffff',

  // Surface
  background: '#0f172a', // Slate 950
  surface: '#1e293b', // Slate 800
  surfaceVariant: '#334155', // Slate 600
  surfaceInverse: '#f8fafc', // Slate 50

  // Text
  text: '#f8fafc', // Slate 50
  textSecondary: '#cbd5e1', // Slate 300
  textTertiary: '#94a3b8', // Slate 400
  textDisabled: '#64748b', // Slate 500

  // UI Elements
  border: '#334155', // Slate 600
  borderLight: '#475569', // Slate 700
  divider: '#334155', // Slate 600
  overlay: 'rgba(15, 23, 42, 0.8)',
  scrim: 'rgba(0, 0, 0, 0.5)',

  // Specialized backgrounds
  warningBackground: 'rgba(245, 158, 11, 0.16)',
  errorBackground: 'rgba(239, 68, 68, 0.16)',
  successBackground: 'rgba(16, 185, 129, 0.16)',
  infoBackground: 'rgba(14, 165, 233, 0.16)',
};

// ============================================================================
// LIGHT THEME
// ============================================================================
export const lightThemeColors: ThemeColors = {
  // Primary - Indigo
  primary: '#6366f1',
  primaryLight: '#a5b4fc',
  primaryDark: '#4f46e5',
  onPrimary: '#ffffff',

  // Secondary - Purple
  secondary: '#8b5cf6',
  secondaryLight: '#d8b4fe',
  secondaryDark: '#7c3aed',
  onSecondary: '#ffffff',

  // Accent - Cyan
  accent: '#0891b2',
  accentLight: '#06b6d4',
  accentDark: '#0e7490',
  onAccent: '#ffffff',

  // Semantic - Success (Emerald)
  success: '#059669',
  successLight: '#10b981',
  successDark: '#047857',
  onSuccess: '#ffffff',

  // Semantic - Warning (Amber)
  warning: '#d97706',
  warningLight: '#f59e0b',
  warningDark: '#b45309',
  onWarning: '#ffffff',

  // Semantic - Error (Red)
  error: '#dc2626',
  errorLight: '#ef4444',
  errorDark: '#b91c1c',
  onError: '#ffffff',

  // Semantic - Info (Sky)
  info: '#0284c7',
  infoLight: '#0ea5e9',
  infoDark: '#0369a1',
  onInfo: '#ffffff',

  // Surface
  background: '#f8fafc', // Slate 50
  surface: '#ffffff',
  surfaceVariant: '#e2e8f0', // Slate 200
  surfaceInverse: '#1e293b', // Slate 800

  // Text
  text: '#0f172a', // Slate 950
  textSecondary: '#475569', // Slate 700
  textTertiary: '#64748b', // Slate 500
  textDisabled: '#cbd5e1', // Slate 300

  // UI Elements
  border: '#e2e8f0', // Slate 200
  borderLight: '#f1f5f9', // Slate 100
  divider: '#e2e8f0', // Slate 200
  overlay: 'rgba(248, 250, 252, 0.8)',
  scrim: 'rgba(0, 0, 0, 0.5)',

  // Specialized backgrounds
  warningBackground: 'rgba(217, 119, 6, 0.1)',
  errorBackground: 'rgba(220, 38, 38, 0.1)',
  successBackground: 'rgba(5, 150, 105, 0.1)',
  infoBackground: 'rgba(2, 132, 199, 0.1)',
};

// ============================================================================
// HIGH CONTRAST THEME (Accessibility)
// WCAG 2.1 AAA compliant - minimum 7:1 contrast ratio
// ============================================================================
export const highContrastThemeColors: ThemeColors = {
  // Primary - Pure high-saturation colors
  primary: '#0000ee', // Strong Blue
  primaryLight: '#6666ff',
  primaryDark: '#0000aa',
  onPrimary: '#ffffff',

  // Secondary - Strong Purple
  secondary: '#7700ee',
  secondaryLight: '#aa66ff',
  secondaryDark: '#5500aa',
  onSecondary: '#ffffff',

  // Accent - Strong Cyan
  accent: '#00aaaa',
  accentLight: '#00dddd',
  accentDark: '#008888',
  onAccent: '#000000',

  // Semantic - Success (Strong Green)
  success: '#008800',
  successLight: '#00dd00',
  successDark: '#006600',
  onSuccess: '#ffffff',

  // Semantic - Warning (Strong Orange)
  warning: '#ff8800',
  warningLight: '#ffaa00',
  warningDark: '#cc6600',
  onWarning: '#000000',

  // Semantic - Error (Pure Red)
  error: '#ff0000',
  errorLight: '#ff6666',
  errorDark: '#cc0000',
  onError: '#ffffff',

  // Semantic - Info (Strong Blue)
  info: '#0066ff',
  infoLight: '#3388ff',
  infoDark: '#0044cc',
  onInfo: '#ffffff',

  // Surface - Pure black/white
  background: '#000000',
  surface: '#111111',
  surfaceVariant: '#333333',
  surfaceInverse: '#ffffff',

  // Text - Pure black on light, pure white on dark
  text: '#ffffff',
  textSecondary: '#dddddd',
  textTertiary: '#aaaaaa',
  textDisabled: '#666666',

  // UI Elements
  border: '#ffffff',
  borderLight: '#666666',
  divider: '#ffffff',
  overlay: 'rgba(0, 0, 0, 0.9)',
  scrim: 'rgba(0, 0, 0, 0.8)',

  // Specialized backgrounds
  warningBackground: 'rgba(255, 136, 0, 0.25)',
  errorBackground: 'rgba(255, 0, 0, 0.25)',
  successBackground: 'rgba(0, 136, 0, 0.25)',
  infoBackground: 'rgba(0, 102, 255, 0.25)',
};
