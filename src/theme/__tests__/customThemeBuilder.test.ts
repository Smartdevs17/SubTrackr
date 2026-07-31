import {
  hexToRgb,
  rgbToHex,
  blendColor,
  lightenColor,
  darkenColor,
  getContrastTextColor,
  generateSemanticPalette,
  generateExtendedColors,
  generateSurfaceColors,
  buildThemeFromConfig,
  createThemeVariantPair,
  inheritTheme,
  generateUniqueThemeId,
} from '../customThemeBuilder';
import { darkTheme } from '../themes';
import type { ThemeConfig } from '../types';

describe('hexToRgb', () => {
  it('converts hex to rgb', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('handles shorthand hex', () => {
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('returns null for invalid hex', () => {
    expect(hexToRgb('invalid')).toBeNull();
    expect(hexToRgb('#gggggg')).toBeNull();
  });
});

describe('rgbToHex', () => {
  it('converts rgb to hex', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
  });

  it('clamps values', () => {
    expect(rgbToHex(300, -1, 128)).toBe('#ff0080');
  });
});

describe('blendColor', () => {
  it('blends two colors', () => {
    const result = blendColor('#ff0000', '#0000ff', 0.5);
    const rgb = hexToRgb(result);
    expect(rgb).not.toBeNull();
    expect(rgb!.r).toBeCloseTo(128, 0);
    expect(rgb!.g).toBeCloseTo(0, 0);
    expect(rgb!.b).toBeCloseTo(128, 0);
  });

  it('returns first color on invalid input', () => {
    expect(blendColor('invalid', '#0000ff', 0.5)).toBe('invalid');
  });
});

describe('lightenColor', () => {
  it('lightens a color', () => {
    const result = lightenColor('#000000', 50);
    expect(hexToRgb(result)).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe('darkenColor', () => {
  it('darkens a color', () => {
    const result = darkenColor('#ffffff', 50);
    expect(hexToRgb(result)).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe('getContrastTextColor', () => {
  it('returns dark text for light backgrounds', () => {
    expect(getContrastTextColor('#ffffff')).toBe('#0f172a');
  });

  it('returns light text for dark backgrounds', () => {
    expect(getContrastTextColor('#000000')).toBe('#f8fafc');
  });
});

describe('generateSemanticPalette', () => {
  it('generates semantic colors from primary', () => {
    const palette = generateSemanticPalette('#6366f1', 'light');
    expect(palette.success).toBeDefined();
    expect(palette.warning).toBeDefined();
    expect(palette.error).toBeDefined();
    expect(palette.info).toBeDefined();
  });

  it('handles invalid color gracefully', () => {
    const palette = generateSemanticPalette('invalid', 'light');
    expect(palette.success).toBe('#10b981');
  });
});

describe('generateExtendedColors', () => {
  it('generates all extended color fields', () => {
    const colors = {
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
    };
    const extended = generateExtendedColors(colors, 'dark');
    expect(extended.primaryLight).toBeDefined();
    expect(extended.primaryDark).toBeDefined();
    expect(extended.onPrimary).toBeDefined();
    expect(extended.scrim).toBeDefined();
    expect(extended.warningBackground).toContain('rgba');
  });
});

describe('generateSurfaceColors', () => {
  it('generates dark surface colors', () => {
    const surfaces = generateSurfaceColors('#6366f1', 'dark');
    expect(surfaces.background).toBeDefined();
    expect(surfaces.surface).toBeDefined();
    expect(surfaces.text).toBe('#f8fafc');
  });

  it('generates light surface colors', () => {
    const surfaces = generateSurfaceColors('#6366f1', 'light');
    expect(surfaces.surface).toBe('#ffffff');
    expect(surfaces.text).toBe('#0f172a');
  });

  it('falls back to default for invalid colors', () => {
    const surfaces = generateSurfaceColors('invalid', 'dark');
    expect(surfaces.background).toBe('#0f172a');
  });
});

describe('buildThemeFromConfig', () => {
  it('builds a full theme from minimal config', () => {
    const config: ThemeConfig = {
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
    };
    const theme = buildThemeFromConfig(config, 'dark', 'test-id', 'Test Theme');
    expect(theme.id).toBe('test-id-dark');
    expect(theme.mode).toBe('dark');
    expect(theme.colors.primary).toBe('#ff0000');
    expect(theme.colors.secondary).toBe('#00ff00');
    expect(theme.colors.accent).toBe('#0000ff');
    expect(theme.isCustom).toBe(true);
    expect(theme.extendedColors).toBeDefined();
    expect(theme.createdAt).toBeDefined();
  });

  it('uses defaults for missing colors', () => {
    const config: ThemeConfig = {
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
    };
    const theme = buildThemeFromConfig(config, 'dark', 'test', 'Test');
    expect(theme.colors.success).toBeDefined();
    expect(theme.colors.background).toBeDefined();
  });

  it('includes fonts and logo when provided', () => {
    const config: ThemeConfig = {
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
      fonts: { family: 'Inter' },
    };
    const theme = buildThemeFromConfig(config, 'light', 'test', 'Test');
    expect(theme.fonts?.family).toBe('Inter');
  });
});

describe('createThemeVariantPair', () => {
  it('creates light and dark variants', () => {
    const config: ThemeConfig = {
      colors: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' },
    };
    const pair = createThemeVariantPair(config, 'brand-test', 'Test Brand');
    expect(pair.light.mode).toBe('light');
    expect(pair.dark.mode).toBe('dark');
    expect(pair.sharedConfig.id).toBe('brand-test');
    expect(pair.light.colors.primary).toBe('#ff0000');
    expect(pair.dark.colors.primary).toBe('#ff0000');
  });
});

describe('inheritTheme', () => {
  it('inherits from parent with overrides', () => {
    const inherited = inheritTheme(darkTheme, { primary: '#ff0000' });
    expect(inherited.parentId).toBe('dark');
    expect(inherited.colors.primary).toBe('#ff0000');
    expect(inherited.colors.secondary).toBe(darkTheme.colors.secondary);
    expect(inherited.isCustom).toBe(true);
  });
});

describe('generateUniqueThemeId', () => {
  it('generates unique ids', () => {
    const id1 = generateUniqueThemeId();
    const id2 = generateUniqueThemeId();
    expect(id1).not.toBe(id2);
    expect(id1).toContain('custom-');
  });
});
