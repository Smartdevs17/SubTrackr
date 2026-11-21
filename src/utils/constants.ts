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
  /** Alias of `text`; used across screens as the primary foreground token. */
  textPrimary: '#f8fafc', // Slate 50
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





// Layout tokens live in the shared UI package so the app and Storybook agree.
export { spacing, borderRadius, typography, shadows } from '../../packages/ui/src/tokens';

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
