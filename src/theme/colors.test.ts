import { darkColors, lightColors } from './colors';

function collectPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

function isValidColor(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  return (
    /^#[0-9a-fA-F]{6}$/.test(value) ||
    /^#[0-9a-fA-F]{8}$/.test(value) ||
    /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(\s*,\s*(0|1|0?\.\d+))?\s*\)$/.test(value)
  );
}

describe('theme colors', () => {
  it('light and dark palettes have the same key structure', () => {
    expect(collectPaths(lightColors).sort()).toEqual(collectPaths(darkColors).sort());
  });

  it('all values are valid colors', () => {
    for (const palette of [lightColors, darkColors]) {
      const walk = (value: unknown): void => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          expect(isValidColor(value)).toBe(true);
          return;
        }

        for (const child of Object.values(value as Record<string, unknown>)) {
          walk(child);
        }
      };

      walk(palette);
    }
  });

  it('dark background primary is OLED black', () => {
    expect(darkColors.background.primary).toBe('#000000');
  });
});
