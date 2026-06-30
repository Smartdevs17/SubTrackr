import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import {
  darkTheme,
  lightTheme,
  highContrastTheme,
  builtInThemes,
  createBrandTheme,
} from './themes';
import {
  buildThemeFromConfig,
  createThemeVariantPair,
  generateUniqueThemeId,
  inheritTheme,
} from './customThemeBuilder';
import { getAccessibilityRating } from './accessibility';
import { themeService } from '../services/themeService';
import type {
  Theme,
  ThemeConfig,
  BrandConfig,
  ThemeMode,
  ThemeVariantPair,
  ThemeExportData,
  ThemePreviewState,
  ThemeColors,
} from './types';

export type StoreThemeMode = ThemeMode | 'system';

interface ThemeState {
  activeThemeId: string;
  customThemes: Theme[];
  themeVariantPairs: ThemeVariantPair[];
  theme: Theme;
  preview: ThemePreviewState;
  lastSyncedAt: string | null;
  isSyncing: boolean;

  setTheme: (id: string) => void;
  addBrandTheme: (brand: BrandConfig, id: string, name: string) => Theme;
  updateCustomTheme: (id: string, config: Partial<ThemeConfig>) => void;
  removeCustomTheme: (id: string) => void;

  addThemeVariantPair: (pair: ThemeVariantPair) => void;
  removeThemeVariantPair: (pairId: string) => void;

  startPreview: (config: Partial<ThemeConfig>) => void;
  updatePreview: (config: Partial<ThemeConfig>) => void;
  applyPreview: () => void;
  discardPreview: () => void;

  exportTheme: (theme: Theme) => ThemeExportData;
  importTheme: (data: ThemeExportData) => void;

  syncToApi: () => Promise<void>;
  syncFromApi: () => Promise<void>;

  allThemes: () => Theme[];
  getThemeById: (id: string) => Theme | undefined;
  getVariantPair: (pairId: string) => ThemeVariantPair | undefined;
}

function fullThemeList(custom: Theme[], variantPairs: ThemeVariantPair[]): Theme[] {
  const pairThemes = variantPairs.flatMap((p) => [p.light, p.dark]);
  return [...builtInThemes, ...custom, ...pairThemes];
}

function resolveTheme(id: string, custom: Theme[], variantPairs: ThemeVariantPair[]): Theme {
  const all = fullThemeList(custom, variantPairs);
  return all.find((t) => t.id === id) ?? darkTheme;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      activeThemeId: darkTheme.id,
      customThemes: [],
      themeVariantPairs: [],
      theme: darkTheme,
      preview: { isPreviewing: false, previewConfig: null, originalThemeId: null },
      lastSyncedAt: null,
      isSyncing: false,

      setTheme(id) {
        const theme = resolveTheme(id, get().customThemes, get().themeVariantPairs);
        set({ activeThemeId: id, theme });
      },

      addBrandTheme(brand, id, name) {
        const base = get().theme.mode === 'dark' ? darkTheme : lightTheme;
        const newTheme = createBrandTheme(base, brand, id, name);
        const accessible = getAccessibilityRating(newTheme);
        const themeWithA11y = { ...newTheme, accessibility: accessible, isCustom: true };

        set((s) => {
          const customThemes = [...s.customThemes.filter((t) => t.id !== id), themeWithA11y];
          return { customThemes, activeThemeId: id, theme: themeWithA11y };
        });
        return themeWithA11y;
      },

      updateCustomTheme(id, config) {
        set((s) => {
          const idx = s.customThemes.findIndex((t) => t.id === id);
          if (idx === -1) return s;

          const current = s.customThemes[idx];
          const updatedTheme = buildThemeFromConfig(
            {
              colors: {
                primary: config.colors?.primary || current.colors.primary,
                secondary: config.colors?.secondary || current.colors.secondary,
                accent: config.colors?.accent || current.colors.accent,
                success: config.colors?.success || current.colors.success,
                warning: config.colors?.warning || current.colors.warning,
                error: config.colors?.error || current.colors.error,
                background: config.colors?.background || current.colors.background,
                surface: config.colors?.surface || current.colors.surface,
                text: config.colors?.text || current.colors.text,
                textSecondary: config.colors?.textSecondary || current.colors.textSecondary,
              },
              fonts: config.fonts || current.fonts,
              logo: config.logo || current.logo,
              metadata: config.metadata || current.metadata,
            },
            current.mode,
            id,
            current.name.replace(/\s*(Light|Dark)$/, '')
          );

          const accessible = getAccessibilityRating(updatedTheme);
          const themeWithA11y = { ...updatedTheme, accessibility: accessible };

          const customThemes = [...s.customThemes];
          customThemes[idx] = themeWithA11y;

          const newState: Partial<ThemeState> = { customThemes };
          if (s.activeThemeId === id) {
            newState.activeThemeId = id;
            newState.theme = themeWithA11y;
          }
          return newState as ThemeState;
        });
      },

      removeCustomTheme(id) {
        set((s) => {
          const customThemes = s.customThemes.filter((t) => t.id !== id);
          const activeThemeId = s.activeThemeId === id ? darkTheme.id : s.activeThemeId;
          const theme = resolveTheme(activeThemeId, customThemes, s.themeVariantPairs);
          return { customThemes, activeThemeId, theme };
        });
      },

      addThemeVariantPair(pair) {
        set((s) => {
          const existing = s.themeVariantPairs.findIndex(
            (p) => p.sharedConfig.id === pair.sharedConfig.id
          );
          const themeVariantPairs = [...s.themeVariantPairs];
          if (existing >= 0) {
            themeVariantPairs[existing] = pair;
          } else {
            themeVariantPairs.push(pair);
          }
          return { themeVariantPairs };
        });
      },

      removeThemeVariantPair(pairId) {
        set((s) => {
          const pair = s.themeVariantPairs.find((p) => p.sharedConfig.id === pairId);
          const variantIds = pair ? [pair.light.id, pair.dark.id] : [];
          const themeVariantPairs = s.themeVariantPairs.filter((p) => p.sharedConfig.id !== pairId);
          const activeThemeId = variantIds.includes(s.activeThemeId)
            ? darkTheme.id
            : s.activeThemeId;
          const theme = resolveTheme(activeThemeId, s.customThemes, themeVariantPairs);
          return { themeVariantPairs, activeThemeId, theme };
        });
      },

      startPreview(config) {
        set({
          preview: {
            isPreviewing: true,
            previewConfig: config,
            originalThemeId: get().activeThemeId,
          },
        });
      },

      updatePreview(config) {
        set((s) => {
          if (!s.preview.isPreviewing) return s;
          return {
            preview: {
              ...s.preview,
              previewConfig: { ...s.preview.previewConfig, ...config } as ThemeConfig,
            },
          };
        });
      },

      applyPreview() {
        const { preview } = get();
        if (!preview.isPreviewing || !preview.previewConfig) return;

        const id = generateUniqueThemeId();
        const theme = buildThemeFromConfig(preview.previewConfig, get().theme.mode, id, 'Preview');
        set((s) => ({
          customThemes: [...s.customThemes, theme],
          activeThemeId: id,
          theme,
          preview: { isPreviewing: false, previewConfig: null, originalThemeId: null },
        }));
      },

      discardPreview() {
        const { preview } = get();
        if (!preview.isPreviewing) return;
        const originalId = preview.originalThemeId || darkTheme.id;
        const theme = resolveTheme(originalId, get().customThemes, get().themeVariantPairs);
        set({
          activeThemeId: originalId,
          theme,
          preview: { isPreviewing: false, previewConfig: null, originalThemeId: null },
        });
      },

      exportTheme(theme) {
        return {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          theme: {
            [theme.mode === 'dark' ? 'dark' : 'light']: {
              colors: { ...theme.colors },
              fonts: theme.fonts,
              logo: theme.logo,
              metadata: theme.metadata,
            },
            shared: {
              id: theme.id,
              name: theme.name,
              fonts: theme.fonts,
              logo: theme.logo,
              metadata: theme.metadata,
              createdAt: theme.createdAt,
              updatedAt: theme.updatedAt,
            },
          },
        };
      },

      importTheme(data) {
        const { shared } = data.theme;
        const modeConfig = data.theme.light || data.theme.dark;
        if (!modeConfig) return;

        const mode: ThemeMode = data.theme.dark ? 'dark' : 'light';
        const id = shared.id || `imported-${Date.now()}`;
        const theme = buildThemeFromConfig(modeConfig, mode, id, shared.name || 'Imported Theme');
        const accessible = getAccessibilityRating(theme);
        const themeWithA11y = { ...theme, accessibility: accessible };

        set((s) => ({
          customThemes: [...s.customThemes.filter((t) => t.id !== id), themeWithA11y],
          activeThemeId: id,
          theme: themeWithA11y,
        }));
      },

      syncToApi: async () => {
        set({ isSyncing: true });
        try {
          const { customThemes, themeVariantPairs } = get();
          const allCustom = [...customThemes];
          await themeService.syncThemesToRemote(allCustom);
          for (const pair of themeVariantPairs) {
            await themeService.saveThemeVariantPair(pair);
          }
          set({ lastSyncedAt: new Date().toISOString(), isSyncing: false });
        } catch {
          set({ isSyncing: false });
        }
      },

      syncFromApi: async () => {
        set({ isSyncing: true });
        try {
          const result = await themeService.fetchThemes();
          if (result.success && result.data) {
            const customThemes: Theme[] = [];
            for (const record of result.data) {
              const theme = buildThemeFromConfig(record.config, 'dark', record.id, record.name);
              const accessible = getAccessibilityRating(theme);
              customThemes.push({ ...theme, accessibility: accessible });
            }
            const activeThemeId = get().activeThemeId;
            const theme = resolveTheme(activeThemeId, customThemes, get().themeVariantPairs);
            set({ customThemes, theme, lastSyncedAt: new Date().toISOString(), isSyncing: false });
          } else {
            set({ isSyncing: false });
          }
        } catch {
          set({ isSyncing: false });
        }
      },

      allThemes() {
        return fullThemeList(get().customThemes, get().themeVariantPairs);
      },

      getThemeById(id) {
        return fullThemeList(get().customThemes, get().themeVariantPairs).find((t) => t.id === id);
      },

      getVariantPair(pairId) {
        return get().themeVariantPairs.find((p) => p.sharedConfig.id === pairId);
      },
    }),
    {
      name: 'subtrackr-theme',
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (s) => ({
        activeThemeId: s.activeThemeId,
        customThemes: s.customThemes,
        themeVariantPairs: s.themeVariantPairs,
        lastSyncedAt: s.lastSyncedAt,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.theme = resolveTheme(
            state.activeThemeId,
            state.customThemes,
            state.themeVariantPairs
          );
        }
      },
    }
  )
);
