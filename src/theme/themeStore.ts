import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import { darkTheme, lightTheme, builtInThemes, createBrandTheme } from './themes';
import type { Theme, BrandConfig } from './types';

interface ThemeState {
  activeThemeId: string;
  customThemes: Theme[];
  // derived — always computed from activeThemeId + customThemes
  theme: Theme;

  setTheme: (id: string) => void;
  toggleMode: () => void;
  addBrandTheme: (brand: BrandConfig, id: string, name: string) => void;
  removeCustomTheme: (id: string) => void;
  allThemes: () => Theme[];
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
    }),
    {
      name: 'subtrackr-theme',
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (s) => ({ activeThemeId: s.activeThemeId, customThemes: s.customThemes }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.theme = resolveTheme(state.activeThemeId, state.customThemes);
        }
      },
    }
  )
);
