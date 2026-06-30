import type { Theme, ExtendedThemeColors, FontConfig } from './types';
import { hexToRgb } from './customThemeBuilder';

export interface CSSVariables {
  [key: string]: string;
}

const PREFIX = '--st';

export function flattenColorsToVariables(
  colors: Record<string, string>,
  prefix: string = PREFIX
): CSSVariables {
  const vars: CSSVariables = {};
  const sep = prefix.endsWith('-') ? '' : '-';
  for (const [key, value] of Object.entries(colors)) {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    vars[`${prefix}${sep}${cssKey}`] = value;
    const rgb = hexToRgb(value);
    if (rgb) {
      vars[`${prefix}${sep}${cssKey}-rgb`] = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    }
  }
  return vars;
}

export function flattenFontVariables(fonts: FontConfig, prefix: string = PREFIX): CSSVariables {
  const vars: CSSVariables = {};
  if (fonts.family) {
    vars[`${prefix}-font-family`] = fonts.family;
  }
  if (fonts.url) {
    vars[`${prefix}-font-url`] = fonts.url;
  }
  if (fonts.sizes) {
    if (fonts.sizes.body) vars[`${prefix}-font-size-body`] = `${fonts.sizes.body}px`;
    if (fonts.sizes.small) vars[`${prefix}-font-size-small`] = `${fonts.sizes.small}px`;
    if (fonts.sizes.large) vars[`${prefix}-font-size-large`] = `${fonts.sizes.large}px`;
    if (fonts.sizes.heading) vars[`${prefix}-font-size-heading`] = `${fonts.sizes.heading}px`;
  }
  return vars;
}

export function generateCSSVariablesFromTheme(theme: Theme): CSSVariables {
  const vars: CSSVariables = {};

  Object.assign(vars, flattenColorsToVariables(theme.colors as unknown as Record<string, string>));

  if (theme.extendedColors) {
    Object.assign(
      vars,
      flattenColorsToVariables(
        theme.extendedColors as unknown as Record<string, string>,
        `${PREFIX}-ext-`
      )
    );
  }

  if (theme.fonts) {
    Object.assign(vars, flattenFontVariables(theme.fonts));
  }

  if (theme.logo) {
    if (theme.logo.uri) vars[`${PREFIX}-logo-uri`] = `url(${theme.logo.uri})`;
    if (theme.logo.width) vars[`${PREFIX}-logo-width`] = `${theme.logo.width}px`;
    if (theme.logo.height) vars[`${PREFIX}-logo-height`] = `${theme.logo.height}px`;
  }

  return vars;
}

export function cssVariablesToString(vars: CSSVariables): string {
  return Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');
}

export function generateCSSVariablesDeclaration(theme: Theme): string {
  const vars = generateCSSVariablesFromTheme(theme);
  return `:root {\n${cssVariablesToString(vars)}\n}`;
}

export function generateThemeStylesheet(theme: Theme): string {
  const vars = generateCSSVariablesFromTheme(theme);
  const lines: string[] = [
    `/* SubTrackr Theme: ${theme.name} (${theme.mode}) */`,
    `/* Theme ID: ${theme.id} */`,
    `/* Generated: ${new Date().toISOString()} */`,
    '',
    `:root {`,
  ];

  for (const [key, value] of Object.entries(vars)) {
    lines.push(`  ${key}: ${value};`);
  }

  lines.push('}', '');
  lines.push(`.theme-${theme.id} {`);

  for (const [key, value] of Object.entries(vars)) {
    lines.push(`  ${key}: ${value};`);
  }

  lines.push('}');

  return lines.join('\n');
}

export function buildStyleObjectFromTheme(theme: Theme): Record<string, string> {
  const vars = generateCSSVariablesFromTheme(theme);
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    const reactKey = key.replace(PREFIX, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    style[reactKey] = value;
  }
  return style;
}
