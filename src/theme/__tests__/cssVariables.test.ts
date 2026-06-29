import {
  flattenColorsToVariables,
  flattenFontVariables,
  generateCSSVariablesFromTheme,
  cssVariablesToString,
  generateCSSVariablesDeclaration,
  generateThemeStylesheet,
} from '../cssVariables';
import { darkTheme } from '../themes';
import type { FontConfig } from '../types';

describe('flattenColorsToVariables', () => {
  it('converts color map to CSS variables', () => {
    const vars = flattenColorsToVariables({ primary: '#ff0000', secondary: '#00ff00' });
    expect(vars['--st-primary']).toBe('#ff0000');
    expect(vars['--st-secondary']).toBe('#00ff00');
  });

  it('generates rgb variables for valid hex colors', () => {
    const vars = flattenColorsToVariables({ primary: '#ff0000' });
    expect(vars['--st-primary-rgb']).toBe('255, 0, 0');
  });

  it('converts camelCase to kebab-case', () => {
    const vars = flattenColorsToVariables({ textSecondary: '#666' });
    expect(vars['--st-text-secondary']).toBe('#666');
  });

  it('uses custom prefix', () => {
    const vars = flattenColorsToVariables({ primary: '#ff0000' }, '--custom-');
    expect(vars['--custom-primary']).toBe('#ff0000');
  });
});

describe('flattenFontVariables', () => {
  it('generates font CSS variables', () => {
    const fonts: FontConfig = {
      family: 'Inter',
      sizes: { body: 16, heading: 32 },
    };
    const vars = flattenFontVariables(fonts);
    expect(vars['--st-font-family']).toBe('Inter');
    expect(vars['--st-font-size-body']).toBe('16px');
    expect(vars['--st-font-size-heading']).toBe('32px');
  });
});

describe('generateCSSVariablesFromTheme', () => {
  it('generates variables from a full theme', () => {
    const vars = generateCSSVariablesFromTheme(darkTheme);
    expect(vars['--st-primary']).toBe(darkTheme.colors.primary);
    expect(vars['--st-background']).toBe(darkTheme.colors.background);
    expect(vars['--st-primary-rgb']).toBeDefined();
  });

  it('includes extended color variables when available', () => {
    const themeWithExtended = {
      ...darkTheme,
      extendedColors: {
        ...darkTheme.colors,
        primaryLight: '#818cf8',
        primaryDark: '#4f46e5',
        onPrimary: '#ffffff',
        secondaryLight: '#a78bfa',
        secondaryDark: '#7c3aed',
        onSecondary: '#ffffff',
        accentLight: '#22d3ee',
        accentDark: '#0891b2',
        onAccent: '#ffffff',
        successLight: '#6ee7b7',
        successDark: '#059669',
        onSuccess: '#ffffff',
        warningLight: '#fbbf24',
        warningDark: '#d97706',
        onWarning: '#ffffff',
        errorLight: '#fca5a5',
        errorDark: '#dc2626',
        onError: '#ffffff',
        info: '#0ea5e9',
        infoLight: '#38bdf8',
        infoDark: '#0284c7',
        onInfo: '#ffffff',
        surfaceVariant: '#334155',
        surfaceInverse: '#f8fafc',
        textTertiary: '#94a3b8',
        textDisabled: '#64748b',
        borderLight: '#475569',
        divider: '#334155',
        scrim: 'rgba(0, 0, 0, 0.5)',
        warningBackground: 'rgba(245, 158, 11, 0.16)',
        errorBackground: 'rgba(239, 68, 68, 0.16)',
        successBackground: 'rgba(16, 185, 129, 0.16)',
        infoBackground: 'rgba(14, 165, 233, 0.16)',
      },
    };
    const vars = generateCSSVariablesFromTheme(themeWithExtended);
    expect(vars['--st-ext-primary-light']).toBe('#818cf8');
    expect(vars['--st-ext-scrim']).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('includes font variables when fonts are configured', () => {
    const themeWithFonts = {
      ...darkTheme,
      fonts: { family: 'Inter' } as FontConfig,
    };
    const vars = generateCSSVariablesFromTheme(themeWithFonts);
    expect(vars['--st-font-family']).toBe('Inter');
  });

  it('includes logo variables when logo is configured', () => {
    const themeWithLogo = {
      ...darkTheme,
      logo: { uri: 'https://example.com/logo.png', width: 200, height: 100 },
    };
    const vars = generateCSSVariablesFromTheme(themeWithLogo);
    expect(vars['--st-logo-uri']).toBe('url(https://example.com/logo.png)');
    expect(vars['--st-logo-width']).toBe('200px');
    expect(vars['--st-logo-height']).toBe('100px');
  });
});

describe('cssVariablesToString', () => {
  it('formats variables as CSS lines', () => {
    const vars = { '--st-primary': '#ff0000', '--st-secondary': '#00ff00' };
    const result = cssVariablesToString(vars);
    expect(result).toContain('--st-primary: #ff0000;');
    expect(result).toContain('--st-secondary: #00ff00;');
  });
});

describe('generateCSSVariablesDeclaration', () => {
  it('wraps variables in :root selector', () => {
    const result = generateCSSVariablesDeclaration(darkTheme);
    expect(result).toContain(':root {');
    expect(result).toContain('--st-primary:');
    expect(result).toContain('}');
  });
});

describe('generateThemeStylesheet', () => {
  it('generates full stylesheet with theme class', () => {
    const result = generateThemeStylesheet(darkTheme);
    expect(result).toContain('/* SubTrackr Theme: Dark (dark) */');
    expect(result).toContain(':root {');
    expect(result).toContain(`.theme-${darkTheme.id} {`);
  });
});
