import type { Theme, ThemeColors, AccessibilityInfo, AccessibilityIssue } from './types';
import { hexToRgb } from './customThemeBuilder';

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const toLinear = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWcagAA(ratio: number, isLargeText: boolean = false): boolean {
  return ratio >= (isLargeText ? 3 : 4.5);
}

export function meetsWcagAAA(ratio: number, isLargeText: boolean = false): boolean {
  return ratio >= (isLargeText ? 4.5 : 7);
}

export interface ContrastCheckPair {
  name: string;
  foreground: string;
  background: string;
  isLargeText?: boolean;
}

const WCAG_CHECKS: ContrastCheckPair[] = [
  { name: 'text on background', foreground: 'text', background: 'background' },
  { name: 'text on surface', foreground: 'text', background: 'surface' },
  { name: 'textSecondary on background', foreground: 'textSecondary', background: 'background' },
  { name: 'textSecondary on surface', foreground: 'textSecondary', background: 'surface' },
  { name: 'primary on background', foreground: 'primary', background: 'background' },
  { name: 'primary on surface', foreground: 'primary', background: 'surface' },
  {
    name: 'button text on primary',
    foreground: 'onPrimary',
    background: 'primary',
    isLargeText: true,
  },
];

export function checkContrast(
  colors: ThemeColors,
  checks?: ContrastCheckPair[]
): { ratio: number; passesAA: boolean; passesAAA: boolean }[] {
  const pairs = checks ?? WCAG_CHECKS;
  return pairs.map((check) => {
    const fg = colors[check.foreground as keyof ThemeColors] || '#000000';
    const bg = colors[check.background as keyof ThemeColors] || '#ffffff';
    const ratio = contrastRatio(fg, bg);
    return {
      ratio: Math.round(ratio * 100) / 100,
      passesAA: meetsWcagAA(ratio, check.isLargeText),
      passesAAA: meetsWcagAAA(ratio, check.isLargeText),
    };
  });
}

export function getAccessibilityRating(theme: Theme): AccessibilityInfo {
  const colors = theme.colors;
  const issues: AccessibilityIssue[] = [];

  const checks = WCAG_CHECKS.map((check) => {
    const fg = colors[check.foreground as keyof ThemeColors];
    const bg = colors[check.background as keyof ThemeColors];
    const ratio = contrastRatio(fg, bg);
    return { ...check, ratio, fg, bg };
  });

  let minRatio = Infinity;
  let allPassAA = true;
  let allPassAAA = true;

  for (const check of checks) {
    minRatio = Math.min(minRatio, check.ratio);

    const passesAA = meetsWcagAA(check.ratio, check.isLargeText);
    const passesAAA = meetsWcagAAA(check.ratio, check.isLargeText);

    if (!passesAA) allPassAA = false;
    if (!passesAAA) allPassAAA = false;

    const required = check.isLargeText ? 3 : 4.5;
    if (!passesAA) {
      issues.push({
        type: 'contrast',
        element: check.name,
        foreground: check.fg,
        background: check.bg,
        ratio: Math.round(check.ratio * 100) / 100,
        requiredRatio: check.isLargeText ? 3 : 4.5,
        message: `Insufficient contrast: "${check.foreground}" on "${check.background}" — ${Math.round(check.ratio * 100) / 100}:1 (requires ${required}:1)`,
      });
    }
  }

  return {
    contrastRatio: Math.round(minRatio * 100) / 100,
    meetsWcagAA: allPassAA,
    meetsWcagAAA: allPassAAA,
    issues,
  };
}

export function suggestContrastFix(
  foreground: string,
  background: string
): { suggestedForeground: string; suggestedBackground: string } {
  const ratio = contrastRatio(foreground, background);
  if (ratio >= 4.5) return { suggestedForeground: foreground, suggestedBackground: background };

  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);
  if (!fgRgb || !bgRgb) return { suggestedForeground: foreground, suggestedBackground: background };

  const bgLuminance = relativeLuminance(background);
  const targetLight = bgLuminance < 0.5 ? '#f8fafc' : '#0f172a';

  const fgAdjust =
    bgLuminance < 0.5
      ? lightenToRatio(foreground, background, 4.5)
      : darkenToRatio(foreground, background, 4.5);

  return { suggestedForeground: fgAdjust, suggestedBackground: background };
}

export function lightenToRatio(
  foreground: string,
  background: string,
  targetRatio: number
): string {
  const bgLum = relativeLuminance(background);
  const targetLum = targetRatio * (bgLum + 0.05) - 0.05;
  const clampedLum = Math.min(1, Math.max(0, targetLum));
  const rgb = hexToRgb(foreground);
  if (!rgb) return foreground;

  const toSRGB = (c: number): number => {
    const linear = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    const adjusted = Math.min(1, linear + (clampedLum - relativeLuminance(foreground)));
    return adjusted <= 0.0031308 ? 12.92 * adjusted : 1.055 * Math.pow(adjusted, 1 / 2.4) - 0.055;
  };

  const r = Math.round(toSRGB(rgb.r / 255) * 255);
  const g = Math.round(toSRGB(rgb.g / 255) * 255);
  const b = Math.round(toSRGB(rgb.b / 255) * 255);

  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function darkenToRatio(foreground: string, background: string, targetRatio: number): string {
  const bgLum = relativeLuminance(background);
  const targetLum = (bgLum + 0.05) / targetRatio - 0.05;
  const clampedLum = Math.min(1, Math.max(0, targetLum));
  const rgb = hexToRgb(foreground);
  if (!rgb) return foreground;

  const toSRGB = (c: number): number => {
    const linear = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    const adjusted = Math.max(0, linear - (relativeLuminance(foreground) - clampedLum));
    return adjusted <= 0.0031308 ? 12.92 * adjusted : 1.055 * Math.pow(adjusted, 1 / 2.4) - 0.055;
  };

  const r = Math.round(toSRGB(rgb.r / 255) * 255);
  const g = Math.round(toSRGB(rgb.g / 255) * 255);
  const b = Math.round(toSRGB(rgb.b / 255) * 255);

  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function isColorReadable(
  foreground: string,
  background: string,
  level?: 'AA' | 'AAA',
  isLargeText?: boolean
): boolean {
  const ratio = contrastRatio(foreground, background);
  if (level === 'AAA') return meetsWcagAAA(ratio, isLargeText);
  return meetsWcagAA(ratio, isLargeText);
}

export const THEME_CONTRAST_CHECKS = WCAG_CHECKS;
