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

/** Font configuration carried on richer theme objects. */
export interface ThemeFonts {
  family?: string;
  scale?: number;
  [key: string]: unknown;
}

/** Brand logo configuration. */
export interface ThemeLogo {
  uri?: string;
  [key: string]: unknown;
}

/** Arbitrary brand metadata attached to a theme. */
export type ThemeMetadata = Record<string, unknown>;

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

/** Derived colour palette generated from the base theme colors. */
export interface ExtendedThemeColors extends ThemeColors {
  primaryLight: string;
  primaryDark: string;
  onPrimary: string;
  secondaryLight: string;
  secondaryDark: string;
  onSecondary: string;
  accentLight: string;
  accentDark: string;
  onAccent: string;
  successLight: string;
  successDark: string;
  onSuccess: string;
  warningLight: string;
  warningDark: string;
  onWarning: string;
  errorLight: string;
  errorDark: string;
  onError: string;
  info: string;
  infoLight: string;
  infoDark: string;
  onInfo: string;
  surfaceVariant: string;
  surfaceInverse: string;
  textTertiary: string;
  textDisabled: string;
  borderLight: string;
  divider: string;
  scrim: string;
  warningBackground: string;
  errorBackground: string;
  successBackground: string;
  infoBackground: string;
}

/** WCAG contrast ratio result for accessibility validation. */
export interface ContrastResult {
  ratio: number;
  /** AA requires ≥ 4.5 for normal text, ≥ 3 for large text. */
  passesAA: boolean;
  /** AAA requires ≥ 7.0. */
  passesAAA: boolean;
}

/** A single accessibility issue found during a theme audit. */
export interface AccessibilityIssue {
  type: 'contrast';
  element: string;
  foreground: string;
  background: string;
  ratio: number;
  requiredRatio: number;
  message: string;
}

/** Accessibility rating for a theme. */
export interface AccessibilityInfo {
  contrastRatio: number;
  meetsWcagAA: boolean;
  meetsWcagAAA: boolean;
  issues: AccessibilityIssue[];
}

export type ThemeAccessibility = AccessibilityInfo;

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: ThemeColors;
  /** Logo URI shown in branded navigation headers. */
  logoUri?: string;
  /** Font configuration for this theme. */
  font?: ThemeFont;
  /** Richer font configuration (design-system shape). */
  fonts?: ThemeFonts;
  /** Richer logo configuration (design-system shape). */
  logo?: ThemeLogo;
  /** Arbitrary brand metadata. */
  metadata?: ThemeMetadata;
  /** Parent theme id for inherited themes. */
  parentId?: string;
  /** Derived color palette generated from `colors`. */
  extendedColors?: ExtendedThemeColors;
  /** True for user-created brand themes. */
  isCustom?: boolean;
  /** Theme creation time (ISO). */
  createdAt?: string;
  /** Theme last-update time (ISO). */
  updatedAt?: string;
  /** WCAG accessibility rating. */
  accessibility?: ThemeAccessibility;
  /**
   * CSS custom properties generated from this theme's colors.
   * Populated automatically by generateCssVariables; not persisted.
   */
  cssVariables?: Record<string, string>;
}

/** Configuration used to build a theme programmatically. */
export interface ThemeConfig {
  colors?: Partial<ThemeColors>;
  fonts?: ThemeFonts;
  logo?: ThemeLogo;
  metadata?: ThemeMetadata;
}

/** Shared configuration for a light/dark theme variant pair. */
export interface ThemeSharedConfig {
  id: string;
  name: string;
  fonts?: ThemeFonts;
  logo?: ThemeLogo;
  metadata?: ThemeMetadata;
  createdAt?: string;
  updatedAt?: string;
}

/** A light/dark variant pair sharing one brand identity. */
export interface ThemeVariantPair {
  light: Theme;
  dark: Theme;
  sharedConfig: ThemeSharedConfig;
}

/**
 * Serialisable snapshot used for theme export / import.
 * Does not include derived fields like cssVariables.
 */
export interface ThemeExport {
  version: 1;
  theme: Omit<Theme, 'cssVariables'>;
}

/** Versioned export envelope produced by the export workflow. */
export interface ThemeExportData {
  version: '1.0.0';
  exportedAt: string;
  theme: {
    light?: ThemeConfig;
    dark?: ThemeConfig;
    shared: ThemeSharedConfig;
  };
}

/** Partial configuration applied while previewing a theme. */
export interface ThemePreviewConfig {
  colors?: Partial<ThemeColors>;
  logoUri?: string;
  font?: ThemeFont;
}

/** Live preview state. */
export interface ThemePreviewState {
  isPreviewing: boolean;
  originalThemeId: string | null;
  previewConfig: ThemePreviewConfig | null;
}
