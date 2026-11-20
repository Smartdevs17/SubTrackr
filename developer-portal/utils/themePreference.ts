/**
 * Theme preference helpers for the docs dark-mode preview (issue #2110).
 *
 * Precedence: a stored value ('light' | 'dark') wins; otherwise the
 * prefers-color-scheme media query decides. Every storage access is guarded
 * so private browsing, disabled storage or quota errors fall back to the
 * system default instead of throwing.
 */

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'subtrackr.docs.theme';

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isThemeMode = (value: unknown): value is ThemeMode => value === 'light' || value === 'dark';

/** Reads the stored preference. Returns null when absent, invalid or unreadable. */
export function readStoredTheme(storage: ThemeStorage | null | undefined): ThemeMode | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persists the preference. Returns false when storage is unavailable or throws. */
export function writeStoredTheme(storage: ThemeStorage | null | undefined, mode: ThemeMode): boolean {
  if (!storage) return false;
  try {
    storage.setItem(THEME_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

/** System default used when no valid preference is stored. */
export function getDefaultTheme(prefersDark: boolean): ThemeMode {
  return prefersDark ? 'dark' : 'light';
}

/** Stored preference if present, otherwise the system default. */
export function resolveThemeMode(stored: ThemeMode | null, prefersDark: boolean): ThemeMode {
  return stored ?? getDefaultTheme(prefersDark);
}

/** Returns window.localStorage, or null when unavailable (SSR, sandboxed frames, blocked storage). */
export function getBrowserStorage(): ThemeStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** True when the OS/browser asks for a dark color scheme. Defaults to false if unknown. */
export function prefersDarkScheme(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}
