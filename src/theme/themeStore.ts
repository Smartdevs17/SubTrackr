import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkTheme, lightTheme, builtInThemes, createBrandTheme } from './themes';
import { generateCssVariables } from './cssVariables';
import type { Theme, BrandConfig, ThemeExport } from './types';

interface ThemeState {
  activeThemeId: string;
  customThemes: Theme[];
  /** Derived — always computed from activeThemeId + customThemes. */
  theme: Theme;

  /** Switch to a theme by ID. Falls back to dark if not found. */
  setTheme: (id: string) => void;
  /** Toggle between dark and light built-in themes. */
  toggleMode: () => void;
  /**
   * Create (or replace) a custom brand theme from a full BrandConfig.
   * Logo URI and font are included when provided.
   */
  addBrandTheme: (brand: BrandConfig, id: string, name: string) => void;
  /** Remove a custom theme. If it was active, falls back to dark. */
  removeCustomTheme: (id: string) => void;
  /** All built-in + custom themes. */
  allThemes: () => Theme[];
  /**
   * Export a theme as a serialisable JSON string.
   * Omits derived cssVariables to keep the snapshot compact.
   */
  exportTheme: (id: string) => string | null;
  /**
   * Import a previously-exported theme JSON string.
   * Validates the envelope and regenerates CSS variables before storing.
   * Returns the imported theme ID on success, or null on failure.
   */
  importTheme: (json: string) => string | null;
}

function resolveTheme(id: string, custom: Theme[]): Theme {
  return [...builtInThemes, ...custom].find((t) => t.id === id) ?? darkTheme;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      activeThemeId: darkTheme.id,
      customThemes: [],
      theme: darkTheme,

      setTheme(id) {
        const theme = resolveTheme(id, get().customThemes);
        set({ activeThemeId: id, theme });
      },

      toggleMode() {
        const current = get().theme;
        const target = current.mode === 'dark' ? lightTheme : darkTheme;
        set({ activeThemeId: target.id, theme: target });
      },

      addBrandTheme(brand, id, name) {
        const base = get().theme.mode === 'dark' ? darkTheme : lightTheme;
        const newTheme = createBrandTheme(base, brand, id, name);
        set((s) => ({
          customThemes: [...s.customThemes.filter((t) => t.id !== id), newTheme],
          activeThemeId: id,
          theme: newTheme,
        }));
      },

      removeCustomTheme(id) {
        set((s) => {
          const customThemes = s.customThemes.filter((t) => t.id !== id);
          const activeThemeId = s.activeThemeId === id ? darkTheme.id : s.activeThemeId;
          return { customThemes, activeThemeId, theme: resolveTheme(activeThemeId, customThemes) };
        });
      },

      allThemes() {
        return [...builtInThemes, ...get().customThemes];
      },

      exportTheme(id) {
        const theme = resolveTheme(id, get().customThemes);
        if (!theme) return null;
        const { cssVariables: _css, ...rest } = theme;
        const payload: ThemeExport = { version: 1, theme: rest };
        return JSON.stringify(payload, null, 2);
      },

      importTheme(json) {
        try {
          const parsed: unknown = JSON.parse(json);
          if (
            typeof parsed !== 'object' ||
            parsed === null ||
            (parsed as ThemeExport).version !== 1 ||
            typeof (parsed as ThemeExport).theme !== 'object'
          ) {
            return null;
          }
          const imported = (parsed as ThemeExport).theme as Theme;
          imported.cssVariables = generateCssVariables(imported);
          set((s) => ({
            customThemes: [
              ...s.customThemes.filter((t) => t.id !== imported.id),
              imported,
            ],
          }));
          return imported.id;
        } catch {
          return null;
        }
      },
    }),
    {
      name: 'subtrackr-theme',
      storage: createJSONStorage(() => AsyncStorage),
      // Do not persist cssVariables — regenerated on rehydration
      partialize: (s) => ({
        activeThemeId: s.activeThemeId,
        customThemes: s.customThemes.map(({ cssVariables: _css, ...t }) => t),
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.customThemes = state.customThemes.map((t) => ({
            ...t,
            cssVariables: generateCssVariables(t),
          }));
          state.theme = resolveTheme(state.activeThemeId, state.customThemes);
        }
      },
    }
  )
);
