/**
 * Unit tests for the docs dark-mode preference logic (issue #2110).
 * Covers read, write, system default and storage failure paths.
 */

import {
  THEME_STORAGE_KEY,
  getDefaultTheme,
  prefersDarkScheme,
  readStoredTheme,
  resolveThemeMode,
  writeStoredTheme,
} from '../utils/themePreference';

function makeStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: jest.fn((key: string) => (key in data ? data[key] : null)),
    setItem: jest.fn((key: string, value: string) => {
      data[key] = value;
    }),
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error('SecurityError: storage blocked');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('themePreference', () => {
  describe('readStoredTheme()', () => {
    it('returns the stored light or dark value', () => {
      expect(readStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light');
      expect(readStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
    });

    it('returns null when nothing is stored', () => {
      expect(readStoredTheme(makeStorage())).toBeNull();
    });

    it('ignores invalid stored values', () => {
      expect(readStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: 'blue' }))).toBeNull();
      expect(readStoredTheme(makeStorage({ [THEME_STORAGE_KEY]: '' }))).toBeNull();
    });

    it('returns null when storage is missing', () => {
      expect(readStoredTheme(null)).toBeNull();
      expect(readStoredTheme(undefined)).toBeNull();
    });

    it('returns null instead of throwing when storage fails', () => {
      expect(readStoredTheme(throwingStorage)).toBeNull();
    });
  });

  describe('writeStoredTheme()', () => {
    it('writes the mode under the documented key and reports success', () => {
      const storage = makeStorage();
      expect(writeStoredTheme(storage, 'dark')).toBe(true);
      expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
      expect(storage.data[THEME_STORAGE_KEY]).toBe('dark');
    });

    it('returns false when storage is missing', () => {
      expect(writeStoredTheme(null, 'light')).toBe(false);
      expect(writeStoredTheme(undefined, 'light')).toBe(false);
    });

    it('returns false instead of throwing when storage fails', () => {
      expect(writeStoredTheme(throwingStorage, 'dark')).toBe(false);
    });

    it('round-trips with readStoredTheme()', () => {
      const storage = makeStorage();
      writeStoredTheme(storage, 'light');
      expect(readStoredTheme(storage)).toBe('light');
      writeStoredTheme(storage, 'dark');
      expect(readStoredTheme(storage)).toBe('dark');
    });
  });

  describe('default theme', () => {
    it('follows prefers-color-scheme when nothing is stored', () => {
      expect(getDefaultTheme(true)).toBe('dark');
      expect(getDefaultTheme(false)).toBe('light');
      expect(resolveThemeMode(null, true)).toBe('dark');
      expect(resolveThemeMode(null, false)).toBe('light');
    });

    it('prefers a stored value over the system setting', () => {
      expect(resolveThemeMode('light', true)).toBe('light');
      expect(resolveThemeMode('dark', false)).toBe('dark');
    });

    it('falls back to the system default when storage fails', () => {
      const stored = readStoredTheme(throwingStorage);
      expect(resolveThemeMode(stored, true)).toBe('dark');
      expect(resolveThemeMode(stored, false)).toBe('light');
    });

    it('reports light scheme when window is unavailable (node environment)', () => {
      expect(prefersDarkScheme()).toBe(false);
    });
  });
});
