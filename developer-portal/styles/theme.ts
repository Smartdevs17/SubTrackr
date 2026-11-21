export const portalTheme = {
  colors: {
    primary: '#3B82F6',
    primaryDark: '#2563EB',
    primaryLight: '#EFF6FF',
    success: '#22C55E',
    successLight: '#F0FDF4',
    warning: '#F59E0B',
    warningLight: '#FFFBEB',
    error: '#EF4444',
    errorLight: '#FEF2F2',
    background: '#F9FAFB',
    surface: '#FFFFFF',
    text: '#111827',
    textSecondary: '#6B7280',
    textMuted: '#9CA3AF',
    border: '#E5E7EB',
    borderLight: '#F3F4F6',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  borderRadius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
  },
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 28,
  },
  fontWeight: {
    normal: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
};

export type PortalTheme = typeof portalTheme;

export type ThemeColors = typeof portalTheme.colors;

/**
 * Dark-mode color tokens for the docs dark-mode preview (issue #2110).
 * Same keys as portalTheme.colors. Text tokens target WCAG AA (4.5:1) or better
 * against `background` and `surface`.
 */
export const portalDarkColors: ThemeColors = {
  primary: '#60A5FA',
  primaryDark: '#3B82F6',
  primaryLight: '#1E3A8A',
  success: '#4ADE80',
  successLight: '#052E16',
  warning: '#FBBF24',
  warningLight: '#451A03',
  error: '#F87171',
  errorLight: '#450A0A',
  background: '#0F172A',
  surface: '#1E293B',
  text: '#F1F5F9',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  border: '#334155',
  borderLight: '#1E293B',
};

/** Returns the color tokens for a theme mode. */
export function getThemeColors(mode: 'light' | 'dark'): ThemeColors {
  return mode === 'dark' ? portalDarkColors : portalTheme.colors;
}
