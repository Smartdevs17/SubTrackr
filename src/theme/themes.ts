import type { Theme, BrandConfig } from './types';

export const darkTheme: Theme = {
  id: 'dark',
  name: 'Dark',
  mode: 'dark',
  colors: {
    primary: '#6366f1',
    secondary: '#8b5cf6',
    accent: '#06b6d4',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    textSecondary: '#cbd5e1',
    border: '#334155',
    overlay: 'rgba(15, 23, 42, 0.8)',
  },
};

export const lightTheme: Theme = {
  id: 'light',
  name: 'Light',
  mode: 'light',
  colors: {
    primary: '#6366f1',
    secondary: '#8b5cf6',
    accent: '#0891b2',
    success: '#059669',
    warning: '#d97706',
    error: '#dc2626',
    background: '#f8fafc',
    surface: '#ffffff',
    text: '#0f172a',
    textSecondary: '#475569',
    border: '#e2e8f0',
    overlay: 'rgba(248, 250, 252, 0.8)',
  },
};

/**
 * High contrast theme for users who need stronger visual differentiation.
 * Uses pure black/white backgrounds with high-saturation accent colors.
 */
export const highContrastTheme: Theme = {
  id: 'high-contrast',
  name: 'High Contrast',
  mode: 'dark',
  colors: {
    primary: '#ffffff',
    secondary: '#ffff00',
    accent: '#00ffff',
    success: '#00ff00',
    warning: '#ffaa00',
    error: '#ff4444',
    background: '#000000',
    surface: '#1a1a1a',
    text: '#ffffff',
    textSecondary: '#dddddd',
    border: '#ffffff',
    overlay: 'rgba(0, 0, 0, 0.9)',
  },
};

export const builtInThemes: Theme[] = [darkTheme, lightTheme, highContrastTheme];

/** Create a brand theme by overriding brand colors on top of a base theme */
export function createBrandTheme(base: Theme, brand: BrandConfig, id: string, name: string): Theme {
  return {
    ...base,
    id,
    name,
    colors: {
      ...base.colors,
      primary: brand.primary,
      secondary: brand.secondary,
      accent: brand.accent,
    },
  };
}
