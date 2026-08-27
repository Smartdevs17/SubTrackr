// SubTrackr Design System Constants

export const colors = {
  // Brand colors (lightened for WCAG 2.1 AA compliance)
  primary: '#818cf8', // Lighter Indigo (was #6366f1)
  secondary: '#a78bfa', // Lighter Purple (was #8b5cf6)
  accent: '#22d3ee', // Lighter Cyan (was #06b6d4)

  // Status colors (lightened for WCAG 2.1 AA compliance)
  success: '#34d399', // Lighter Emerald (was #10b981)
  warning: '#fbbf24', // Lighter Amber (was #f59e0b)
  error: '#f87171', // Lighter Red (was #ef4444)

  // Background colors (unchanged)
  background: '#0f172a', // Dark slate
  surface: '#1e293b', // Slate 800
  surfaceVariant: '#334155', // Slate 600

  // Text colors (unchanged)
  text: '#f8fafc', // Slate 50
  textSecondary: '#cbd5e1', // Slate 300

  // On-brand colors (unchanged)
  onPrimary: '#ffffff',
  onSecondary: '#ffffff',
  onSurface: '#f8fafc',
  onSurfaceVariant: '#cbd5e1',

  // Border color (lightened for WCAG 2.1 AA compliance)
  border: '#64748b', // Slate 400 (was #334155)

  // Other colors (unchanged)
  overlay: 'rgba(15, 23, 42, 0.8)',
  warningBackground: 'rgba(251, 191, 36, 0.2)', // Adjusted opacity
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  round: 9999,
  full: 9999,
};

export const typography = {
  h1: {
    fontSize: 32,
    fontWeight: 'bold' as const,
    lineHeight: 40,
  },
  h2: {
    fontSize: 24,
    fontWeight: 'bold' as const,
    lineHeight: 32,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 28,
  },
  body: {
    fontSize: 16,
    fontWeight: 'normal' as const,
    lineHeight: 24,
  },
  body2: {
    fontSize: 14,
    fontWeight: 'normal' as const,
    lineHeight: 20,
  },
  button: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 20,
  },
  caption: {
    fontSize: 14,
    fontWeight: 'normal' as const,
    lineHeight: 20,
  },
  small: {
    fontSize: 12,
    fontWeight: 'normal' as const,
    lineHeight: 16,
  },
};

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
};

export const animation = {
  duration: {
    fast: 200,
    normal: 300,
    slow: 500,
  },
  easing: {
    ease: 'ease',
    easeIn: 'ease-in',
    easeOut: 'ease-out',
    easeInOut: 'ease-in-out',
  },
};
