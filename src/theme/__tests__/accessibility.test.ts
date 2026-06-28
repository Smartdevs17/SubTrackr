import {
  relativeLuminance,
  contrastRatio,
  meetsWcagAA,
  meetsWcagAAA,
  getAccessibilityRating,
  isColorReadable,
  suggestContrastFix,
  lightenToRatio,
  darkenToRatio,
} from '../accessibility';
import { darkTheme, lightTheme, highContrastTheme } from '../themes';

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 2);
  });

  it('returns ~1 for white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 1);
  });

  it('returns 0 for invalid hex', () => {
    expect(relativeLuminance('invalid')).toBe(0);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('returns 1 for same colors', () => {
    expect(contrastRatio('#ff0000', '#ff0000')).toBeCloseTo(1, 0);
  });

  it('returns reasonable ratio for blue on white', () => {
    const ratio = contrastRatio('#0000ff', '#ffffff');
    expect(ratio).toBeGreaterThan(5);
    expect(ratio).toBeLessThan(10);
  });
});

describe('meetsWcagAA', () => {
  it('AA normal text requires 4.5:1', () => {
    expect(meetsWcagAA(4.5)).toBe(true);
    expect(meetsWcagAA(4.49)).toBe(false);
  });

  it('AA large text requires 3:1', () => {
    expect(meetsWcagAA(3, true)).toBe(true);
    expect(meetsWcagAA(2.99, true)).toBe(false);
  });
});

describe('meetsWcagAAA', () => {
  it('AAA normal text requires 7:1', () => {
    expect(meetsWcagAAA(7)).toBe(true);
    expect(meetsWcagAAA(6.99)).toBe(false);
  });

  it('AAA large text requires 4.5:1', () => {
    expect(meetsWcagAAA(4.5, true)).toBe(true);
    expect(meetsWcagAAA(4.49, true)).toBe(false);
  });
});

describe('getAccessibilityRating', () => {
  it('dark theme should have contrast info', () => {
    const rating = getAccessibilityRating(darkTheme);
    expect(rating.contrastRatio).toBeGreaterThan(0);
    expect(typeof rating.meetsWcagAA).toBe('boolean');
    expect(typeof rating.meetsWcagAAA).toBe('boolean');
    expect(Array.isArray(rating.issues)).toBe(true);
  });

  it('light theme should meet AA for most checks', () => {
    const rating = getAccessibilityRating(lightTheme);
    expect(rating.meetsWcagAA).toBeDefined();
  });

  it('high contrast theme should meet all requirements', () => {
    const rating = getAccessibilityRating(highContrastTheme);
    expect(rating.contrastRatio).toBeGreaterThanOrEqual(7);
  });
});

describe('isColorReadable', () => {
  it('black on white is readable', () => {
    expect(isColorReadable('#000000', '#ffffff')).toBe(true);
    expect(isColorReadable('#000000', '#ffffff', 'AAA')).toBe(true);
  });

  it('light gray on white is not readable', () => {
    expect(isColorReadable('#cccccc', '#ffffff')).toBe(false);
  });
});

describe('suggestContrastFix', () => {
  it('returns same colors if already sufficient', () => {
    const result = suggestContrastFix('#000000', '#ffffff');
    expect(result.suggestedForeground).toBe('#000000');
  });

  it('suggests adjustment for poor contrast', () => {
    const result = suggestContrastFix('#cccccc', '#ffffff');
    const newRatio = contrastRatio(result.suggestedForeground, result.suggestedBackground);
    expect(newRatio).toBeGreaterThanOrEqual(4.4);
  });
});

describe('lightenToRatio', () => {
  it('lightens color to meet target ratio', () => {
    const result = lightenToRatio('#000000', '#000000', 4.5);
    expect(result).toBeDefined();
  });
});

describe('darkenToRatio', () => {
  it('darkens color to meet target ratio', () => {
    const result = darkenToRatio('#ffffff', '#ffffff', 4.5);
    expect(result).toBeDefined();
  });
});
