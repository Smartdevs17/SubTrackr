import type { Theme, ThemeColors, ContrastResult } from './types';

/**
 * Generate a map of CSS custom properties from a Theme's color palette.
 *
 * Each ThemeColors key becomes `--st-<key>` (kebab-cased).
 * Font family and scale are included when a font is configured.
 *
 * @example
 * const vars = generateCssVariables(darkTheme);
 * // { '--st-primary': '#6366f1', '--st-background': '#0f172a', ... }
 */
export function generateCssVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const [key, value] of Object.entries(theme.colors) as [keyof ThemeColors, string][]) {
    vars[`--st-${toKebab(key)}`] = value;
  }

  if (theme.font?.family) {
    vars['--st-font-family'] = theme.font.family;
  }
  if (theme.font?.scale !== undefined) {
    vars['--st-font-scale'] = String(theme.font.scale);
  }

  vars['--st-mode'] = theme.mode;

  return vars;
}

/**
 * Serialise a CSS variable map to a `:root { … }` block string.
 * Useful for injecting into a web view or generating a stylesheet snippet.
 */
export function toCssBlock(vars: Record<string, string>): string {
  const declarations = Object.entries(vars)
    .map(([prop, val]) => `  ${prop}: ${val};`)
    .join('\n');
  return `:root {\n${declarations}\n}`;
}

// ---------------------------------------------------------------------------
// WCAG contrast helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the WCAG 2.1 relative luminance of a hex colour.
 * Returns a value in [0, 1].
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/**
 * Calculate the WCAG 2.1 contrast ratio between two hex colours.
 *
 * @example
 * contrastRatio('#ffffff', '#000000') // => 21
 * contrastRatio('#6366f1', '#0f172a') // => ~5.8
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Evaluate a foreground/background colour pair against WCAG AA and AAA levels.
 */
export function checkContrast(foreground: string, background: string): ContrastResult {
  const ratio = contrastRatio(foreground, background);
  return {
    ratio: Math.round(ratio * 100) / 100,
    passesAA: ratio >= 4.5,
    passesAAA: ratio >= 7.0,
  };
}

/**
 * Run a full accessibility contrast audit for a theme.
 * Checks text on background, primary on background, and text on surface.
 *
 * Returns a map of pair labels to ContrastResult.
 */
export function auditThemeContrast(theme: Theme): Record<string, ContrastResult> {
  const { colors: c } = theme;
  return {
    'text/background': checkContrast(c.text, c.background),
    'textSecondary/background': checkContrast(c.textSecondary, c.background),
    'text/surface': checkContrast(c.text, c.surface),
    'primary/background': checkContrast(c.primary, c.background),
    'primary/surface': checkContrast(c.primary, c.surface),
    'error/background': checkContrast(c.error, c.background),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toKebab(camel: string): string {
  return camel.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const int = parseInt(full, 16);
  if (isNaN(int)) return null;
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}
