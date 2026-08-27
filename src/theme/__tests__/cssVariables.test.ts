import {
  generateCssVariables,
  toCssBlock,
  checkContrast,
  auditThemeContrast,
  relativeLuminance,
  contrastRatio,
} from '../cssVariables';
import { darkTheme, lightTheme } from '../themes';

describe('generateCssVariables', () => {
  it('maps every ThemeColors key to a --st-* variable', () => {
    const vars = generateCssVariables(darkTheme);
    expect(vars['--st-primary']).toBe(darkTheme.colors.primary);
    expect(vars['--st-background']).toBe(darkTheme.colors.background);
    expect(vars['--st-text-secondary']).toBe(darkTheme.colors.textSecondary);
  });

  it('includes --st-mode', () => {
    expect(generateCssVariables(darkTheme)['--st-mode']).toBe('dark');
    expect(generateCssVariables(lightTheme)['--st-mode']).toBe('light');
  });

  it('includes font variables when a font is configured', () => {
    const themed = { ...darkTheme, font: { family: 'Inter', scale: 1.1 } };
    const vars = generateCssVariables(themed);
    expect(vars['--st-font-family']).toBe('Inter');
    expect(vars['--st-font-scale']).toBe('1.1');
  });

  it('omits font variables when font is not set', () => {
    const vars = generateCssVariables(darkTheme);
    expect(vars['--st-font-family']).toBeUndefined();
    expect(vars['--st-font-scale']).toBeUndefined();
  });
});

describe('toCssBlock', () => {
  it('wraps variables in a :root block', () => {
    const block = toCssBlock({ '--st-primary': '#6366f1' });
    expect(block).toContain(':root {');
    expect(block).toContain('--st-primary: #6366f1;');
    expect(block).toContain('}');
  });
});

describe('relativeLuminance', () => {
  it('returns 1 for white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 4);
  });

  it('returns 0 for black', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 4);
  });

  it('returns 0 for invalid hex', () => {
    expect(relativeLuminance('not-a-color')).toBe(0);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });

  it('returns 1 for identical colours', () => {
    expect(contrastRatio('#6366f1', '#6366f1')).toBeCloseTo(1, 4);
  });

  it('is symmetric', () => {
    const a = contrastRatio('#6366f1', '#0f172a');
    const b = contrastRatio('#0f172a', '#6366f1');
    expect(a).toBeCloseTo(b, 4);
  });
});

describe('checkContrast', () => {
  it('passes AA and AAA for black on white', () => {
    const result = checkContrast('#000000', '#ffffff');
    expect(result.passesAA).toBe(true);
    expect(result.passesAAA).toBe(true);
  });

  it('fails AA for very low contrast pair', () => {
    // near-identical colours
    const result = checkContrast('#eeeeee', '#ffffff');
    expect(result.passesAA).toBe(false);
    expect(result.passesAAA).toBe(false);
  });

  it('rounds ratio to 2 decimal places', () => {
    const result = checkContrast('#6366f1', '#0f172a');
    expect(String(result.ratio)).toMatch(/^\d+\.\d{1,2}$/);
  });
});

describe('auditThemeContrast', () => {
  it('returns results for all expected pairs', () => {
    const audit = auditThemeContrast(darkTheme);
    expect(Object.keys(audit)).toEqual([
      'text/background',
      'textSecondary/background',
      'text/surface',
      'primary/background',
      'primary/surface',
      'error/background',
    ]);
  });

  it('dark theme text on background passes AA', () => {
    const audit = auditThemeContrast(darkTheme);
    expect(audit['text/background'].passesAA).toBe(true);
  });

  it('light theme text on background passes AA', () => {
    const audit = auditThemeContrast(lightTheme);
    expect(audit['text/background'].passesAA).toBe(true);
  });
});
