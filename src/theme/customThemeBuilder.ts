import { lightTheme, darkTheme, highContrastTheme } from './themes';
import type {
  Theme,
  ThemeMode,
  ThemeConfig,
  ThemeColors,
  ExtendedThemeColors,
  FontConfig,
  LogoConfig,
  ThemeVariantPair,
  ThemeSharedConfig,
} from './types';

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex || !hex.startsWith('#') || hex.length < 4) return null;
  const clean = hex.replace('#', '');
  if (clean.length !== 6 && clean.length !== 3) return null;
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  if (isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function blendColor(hex1: string, hex2: string, weight: number): string {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return hex1;
  const w = Math.max(0, Math.min(1, weight));
  return rgbToHex(c1.r * (1 - w) + c2.r * w, c1.g * (1 - w) + c2.g * w, c1.b * (1 - w) + c2.b * w);
}

export function lightenColor(hex: string, percent: number): string {
  return blendColor(hex, '#ffffff', percent / 100);
}

export function darkenColor(hex: string, percent: number): string {
  return blendColor(hex, '#000000', percent / 100);
}

export function getContrastTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? '#0f172a' : '#f8fafc';
}

export function generateSemanticPalette(primary: string, mode: ThemeMode): {
  success: string;
  warning: string;
  error: string;
  info: string;
} {
  const base = hexToRgb(primary);
  if (!base) {
    return { success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#3b82f6' };
  }
  const isDark = mode === 'dark';
  const saturation = isDark ? 0.85 : 0.7;
  return {
    success: rgbToHex(
      Math.round(base.r * (1 - saturation) + (isDark ? 16 : 5) * saturation),
      Math.round(base.g * (1 - saturation) + (isDark ? 185 : 150) * saturation),
      Math.round(base.b * (1 - saturation) + (isDark ? 129 : 105) * saturation),
    ),
    warning: rgbToHex(
      Math.round(base.r * (1 - saturation) + (isDark ? 245 : 217) * saturation),
      Math.round(base.g * (1 - saturation) + (isDark ? 158 : 119) * saturation),
      Math.round(base.b * (1 - saturation) + (isDark ? 11 : 6) * saturation),
    ),
    error: rgbToHex(
      Math.round(base.r * (1 - saturation) + 239 * saturation),
      Math.round(base.g * (1 - saturation) + 68 * saturation),
      Math.round(base.b * (1 - saturation) + 68 * saturation),
    ),
    info: rgbToHex(
      Math.round(base.r * (1 - saturation) + 59 * saturation),
      Math.round(base.g * (1 - saturation) + 130 * saturation),
      Math.round(base.b * (1 - saturation) + 246 * saturation),
    ),
  };
}

export function generateExtendedColors(colors: ThemeColors, mode: ThemeMode): ExtendedThemeColors {
  const isDark = mode === 'dark';
  const lightAmt = isDark ? 20 : 15;
  const darkAmt = isDark ? 15 : 20;
  return {
    ...colors,
    primaryLight: lightenColor(colors.primary, lightAmt),
    primaryDark: darkenColor(colors.primary, darkAmt),
    onPrimary: getContrastTextColor(colors.primary),
    secondaryLight: lightenColor(colors.secondary, lightAmt),
    secondaryDark: darkenColor(colors.secondary, darkAmt),
    onSecondary: getContrastTextColor(colors.secondary),
    accentLight: lightenColor(colors.accent, lightAmt),
    accentDark: darkenColor(colors.accent, darkAmt),
    onAccent: getContrastTextColor(colors.accent),
    successLight: lightenColor(colors.success, lightAmt),
    successDark: darkenColor(colors.success, darkAmt),
    onSuccess: getContrastTextColor(colors.success),
    warningLight: lightenColor(colors.warning, lightAmt),
    warningDark: darkenColor(colors.warning, darkAmt),
    onWarning: getContrastTextColor(colors.warning),
    errorLight: lightenColor(colors.error, lightAmt),
    errorDark: darkenColor(colors.error, darkAmt),
    onError: getContrastTextColor(colors.error),
    info: colors.accent,
    infoLight: lightenColor(colors.accent, lightAmt),
    infoDark: darkenColor(colors.accent, darkAmt),
    onInfo: getContrastTextColor(colors.accent),
    surfaceVariant: isDark ? lightenColor(colors.surface, 10) : darkenColor(colors.surface, 5),
    surfaceInverse: isDark ? '#f8fafc' : '#1e293b',
    textTertiary: isDark ? '#94a3b8' : '#64748b',
    textDisabled: isDark ? '#64748b' : '#cbd5e1',
    borderLight: isDark ? lightenColor(colors.border, 10) : '#f1f5f9',
    divider: colors.border,
    scrim: isDark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.5)',
    warningBackground: hexToRgb(colors.warning)
      ? `rgba(${hexToRgb(colors.warning)!.r}, ${hexToRgb(colors.warning)!.g}, ${hexToRgb(colors.warning)!.b}, ${isDark ? 0.16 : 0.1})`
      : 'rgba(245, 158, 11, 0.16)',
    errorBackground: hexToRgb(colors.error)
      ? `rgba(${hexToRgb(colors.error)!.r}, ${hexToRgb(colors.error)!.g}, ${hexToRgb(colors.error)!.b}, ${isDark ? 0.16 : 0.1})`
      : 'rgba(239, 68, 68, 0.16)',
    successBackground: hexToRgb(colors.success)
      ? `rgba(${hexToRgb(colors.success)!.r}, ${hexToRgb(colors.success)!.g}, ${hexToRgb(colors.success)!.b}, ${isDark ? 0.16 : 0.1})`
      : 'rgba(16, 185, 129, 0.16)',
    infoBackground: hexToRgb(colors.accent)
      ? `rgba(${hexToRgb(colors.accent)!.r}, ${hexToRgb(colors.accent)!.g}, ${hexToRgb(colors.accent)!.b}, ${isDark ? 0.16 : 0.1})`
      : 'rgba(14, 165, 233, 0.16)',
  };
}

export function generateSurfaceColors(primary: string, mode: ThemeMode): {
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
} {
  const isDark = mode === 'dark';
  const rgb = hexToRgb(primary);
  if (!rgb) {
    return isDark
      ? { background: '#0f172a', surface: '#1e293b', text: '#f8fafc', textSecondary: '#cbd5e1', border: '#334155' }
      : { background: '#f8fafc', surface: '#ffffff', text: '#0f172a', textSecondary: '#475569', border: '#e2e8f0' };
  }
  const avg = (rgb.r + rgb.g + rgb.b) / 3;
  if (isDark) {
    const bgBase = Math.max(0, avg * 0.06);
    return {
      background: `hsl(222, 47%, ${Math.max(4, bgBase)}%)`,
      surface: `hsl(222, 43%, ${Math.max(10, bgBase + 8)}%)`,
      text: '#f8fafc',
      textSecondary: '#cbd5e1',
      border: `hsl(222, 30%, ${Math.max(16, bgBase + 14)}%)`,
    };
  }
  const bgBase = Math.min(97, avg * 0.38 + 60);
  return {
    background: `hsl(222, 50%, ${bgBase}%)`,
    surface: '#ffffff',
    text: '#0f172a',
    textSecondary: '#475569',
    border: `hsl(222, 30%, ${bgBase - 8}%)`,
  };
}

type ColorDefaults = Record<string, string | undefined>;

export function buildThemeFromConfig(
  config: Partial<ThemeConfig>,
  mode: ThemeMode,
  baseId: string,
  themeName: string,
): Theme {
  const colors: ColorDefaults = config.colors || {};
  const primary = colors.primary || '#6366f1';
  const secondary = colors.secondary || '#8b5cf6';
  const accent = colors.accent || (mode === 'dark' ? '#06b6d4' : '#0891b2');

  const semantic = generateSemanticPalette(primary, mode);
  const surfaces = generateSurfaceColors(primary, mode);

  const themeColors: ThemeColors = {
    primary,
    secondary,
    accent,
    success: colors.success || semantic.success,
    warning: colors.warning || semantic.warning,
    error: colors.error || semantic.error,
    background: colors.background || surfaces.background,
    surface: colors.surface || surfaces.surface,
    text: colors.text || surfaces.text,
    textSecondary: colors.textSecondary || surfaces.textSecondary,
    border: surfaces.border,
    overlay: mode === 'dark' ? 'rgba(15, 23, 42, 0.8)' : 'rgba(248, 250, 252, 0.8)',
  };

  const extended = generateExtendedColors(themeColors, mode);

  const id = `${baseId}-${mode}`;

  return {
    id,
    name: mode === 'dark' ? `${themeName} Dark` : `${themeName} Light`,
    mode,
    colors: themeColors,
    extendedColors: extended,
    fonts: config.fonts,
    logo: config.logo,
    isCustom: true,
    metadata: config.metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createThemeVariantPair(
  config: ThemeConfig,
  id: string,
  name: string,
  shared?: Partial<ThemeSharedConfig>,
): ThemeVariantPair {
  const sharedConfig: ThemeSharedConfig = {
    id,
    name,
    fonts: config.fonts,
    logo: config.logo,
    metadata: config.metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...shared,
  };

  return {
    light: buildThemeFromConfig(config, 'light', id, name),
    dark: buildThemeFromConfig(config, 'dark', id, name),
    sharedConfig,
  };
}

export function inheritTheme(parent: Theme, overrides: Partial<ThemeColors>): Theme {
  return {
    ...parent,
    id: `${parent.id}-inherited`,
    name: `${parent.name} (Inherited)`,
    colors: { ...parent.colors, ...overrides },
    extendedColors: parent.extendedColors
      ? generateExtendedColors({ ...parent.colors, ...overrides }, parent.mode)
      : undefined,
    parentId: parent.id,
    isCustom: true,
    updatedAt: new Date().toISOString(),
  };
}

export function generateUniqueThemeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}
