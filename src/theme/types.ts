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

export type ThemeMode = 'light' | 'dark';

export interface FontConfig {
  family?: string;
  url?: string;
  weights?: {
    light?: number;
    normal?: number;
    medium?: number;
    semibold?: number;
    bold?: number;
  };
  sizes?: {
    small?: number;
    body?: number;
    large?: number;
    heading?: number;
  };
}

export interface LogoConfig {
  uri?: string;
  darkUri?: string;
  width?: number;
  height?: number;
  altText?: string;
}

export interface AccessibilityInfo {
  contrastRatio: number;
  meetsWcagAA: boolean;
  meetsWcagAAA: boolean;
  issues: AccessibilityIssue[];
}

export interface AccessibilityIssue {
  type: 'contrast' | 'touch-target' | 'font-size';
  element: string;
  foreground: string;
  background: string;
  ratio: number;
  requiredRatio: number;
  message: string;
}

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: ThemeColors;
  extendedColors?: ExtendedThemeColors;
  fonts?: FontConfig;
  logo?: LogoConfig;
  isCustom?: boolean;
  parentId?: string;
  accessibility?: AccessibilityInfo;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ThemeVariantPair {
  light: Theme;
  dark: Theme;
  sharedConfig: ThemeSharedConfig;
}

export interface ThemeSharedConfig {
  id: string;
  name: string;
  fonts?: FontConfig;
  logo?: LogoConfig;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface BrandConfig {
  primary: string;
  secondary: string;
  accent: string;
  fonts?: FontConfig;
  logo?: LogoConfig;
}

export interface ThemeConfig {
  colors: {
    primary: string;
    secondary?: string;
    accent?: string;
    success?: string;
    warning?: string;
    error?: string;
    background?: string;
    surface?: string;
    text?: string;
    textSecondary?: string;
  };
  fonts?: FontConfig;
  logo?: LogoConfig;
  metadata?: Record<string, unknown>;
}

export interface ThemeExportData {
  version: string;
  exportedAt: string;
  theme: {
    light?: ThemeConfig;
    dark?: ThemeConfig;
    shared: ThemeSharedConfig;
  };
}

export interface ThemeInheritance {
  parentId: string;
  overrides: Partial<ThemeColors>;
  extendedOverrides?: Partial<ExtendedThemeColors>;
}

export interface ThemePreviewState {
  isPreviewing: boolean;
  previewConfig: Partial<ThemeConfig> | null;
  originalThemeId: string | null;
}
