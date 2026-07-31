// Theme type definitions

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  overlay: string;
}

export type ThemeMode = 'light' | 'dark';

/** Font configuration for brand themes. */
export interface ThemeFont {
  /** Font family name (must be loaded or available on the device). */
  family: string;
  /** Optional scale factor applied to all font sizes (default: 1). */
  scale?: number;
}

/** Full brand configuration used when creating a custom white-label theme. */
export interface BrandConfig {
  primary: string;
  secondary: string;
  accent: string;
  /** Optional logo URI (local asset path or remote URL). */
  logoUri?: string;
  /** Optional font settings. */
  font?: ThemeFont;
}

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: ThemeColors;
  /** Logo URI shown in branded navigation headers. */
  logoUri?: string;
  /** Font configuration for this theme. */
  font?: ThemeFont;
  /**
   * CSS custom properties generated from this theme's colors.
   * Populated automatically by generateCssVariables; not persisted.
   */
  cssVariables?: Record<string, string>;
}

/**
 * Serialisable snapshot used for theme export / import.
 * Does not include derived fields like cssVariables.
 */
export interface ThemeExport {
  version: 1;
  theme: Omit<Theme, 'cssVariables'>;
}

/** WCAG contrast ratio result for accessibility validation. */
export interface ContrastResult {
  ratio: number;
  /** AA requires ≥ 4.5 for normal text, ≥ 3 for large text. */
  passesAA: boolean;
  /** AAA requires ≥ 7.0. */
  passesAAA: boolean;
}
