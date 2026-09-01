import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkTheme, lightTheme, builtInThemes, createBrandTheme } from './themes';
import { generateCssVariables } from './cssVariables';
import { generateExtendedColors, generateUniqueThemeId } from './customThemeBuilder';
import { getAccessibilityRating } from './accessibility';
import type {
  Theme,
  ThemeConfig,
  ThemeColors,
  ThemeExport,
  ThemeExportData,
  ThemeMode,
  ThemePreviewConfig,
  ThemePreviewState,
  ThemeVariantPair,
  ThemeFont,
} from './types';

interface UpdateCustomThemeConfig {
  colors?: Partial<ThemeColors>;
  logoUri?: string;
  font?: ThemeFont;
}

interface ThemeState {
  activeThemeId: string;
  customThemes: Theme[];
  themeVariantPairs: ThemeVariantPair[];
  /** Live preview state (transient — never persisted). */
  preview: ThemePreviewState;
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
  addBrandTheme: (
    brand: {
      primary: string;
      secondary: string;
      accent: string;
      logoUri?: string;
      font?: ThemeFont;
    },
    id: string,
    name: string
  ) => void;
  /** Update colors / logo / font of an existing custom theme. */
  updateCustomTheme: (id: string, config: UpdateCustomThemeConfig) => void;
  /** Remove a custom theme. If it was active, falls back to dark. */
  removeCustomTheme: (id: string) => void;
  /** All built-in + custom + variant-pair themes. */
  allThemes: () => Theme[];
  /** Begin previewing a theme configuration without committing it. */
  startPreview: (config: ThemePreviewConfig) => void;
  /** Update the configuration while previewing. */
  updatePreview: (config: ThemePreviewConfig) => void;
  /** Commit the preview as a new custom theme. */
  applyPreview: () => void;
  /** Discard the preview and restore the original theme. */
  discardPreview: () => void;
  /** Register a light/dark variant pair for a brand. */
  addThemeVariantPair: (pair: ThemeVariantPair) => void;
  /** Remove a variant pair (and its themes). Falls back to dark if active. */
  removeThemeVariantPair: (sharedId: string) => void;
  /** Look up a variant pair by its shared brand id. */
  getVariantPair: (sharedId: string) => ThemeVariantPair | undefined;
  /**
   * Export a theme. Passing a theme id returns a serialisable JSON string;
   * passing a Theme returns a structured ThemeExportData snapshot.
   */
  exportTheme: {
    (id: string): string | null;
    (theme: Theme): ThemeExportData;
  };
  /**
   * Import a previously-exported theme. Accepts either a JSON string
   * (classic envelope) or a ThemeExportData object. Returns the imported
   * theme ID on success, or null on failure.
   */
  importTheme: {
    (json: string): string | null;
    (data: ThemeExportData): string | null;
  };
}

function resolveTheme(id: string, custom: Theme[]): Theme {
  return [...builtInThemes, ...custom].find((t) => t.id === id) ?? darkTheme;
}

/** Regenerate derived fields (cssVariables, extendedColors, accessibility). */
function refreshDerived(theme: Theme): Theme {
  const next: Theme = {
    ...theme,
    extendedColors: generateExtendedColors(theme.colors, theme.mode),
  };
  next.cssVariables = generateCssVariables(next);
  next.accessibility = getAccessibilityRating(next);
  return next;
}

function exportDataForTheme(theme: Theme): ThemeExportData {
  const config: ThemeConfig = {
    colors: { ...theme.colors },
    fonts: theme.fonts,
    logo: theme.logo,
    metadata: theme.metadata,
  };
  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    theme: {
      [theme.mode === 'dark' ? 'dark' : 'light']: config,
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
}

function themeFromExportData(data: ThemeExportData): Theme {
  const mode: ThemeMode = data.theme.dark ? 'dark' : 'light';
  const side = mode === 'dark' ? data.theme.dark : data.theme.light;
  const base = mode === 'dark' ? darkTheme : lightTheme;
  const colors: ThemeColors = { ...base.colors, ...(side?.colors ?? {}) };
  const now = new Date().toISOString();
  return refreshDerived({
    ...base,
    id: data.theme.shared.id,
    name: data.theme.shared.name,
    mode,
    colors,
    fonts: data.theme.shared.fonts ?? side?.fonts,
    logo: data.theme.shared.logo ?? side?.logo,
    metadata: data.theme.shared.metadata ?? side?.metadata,
    isCustom: true,
    createdAt: data.theme.shared.createdAt ?? now,
    updatedAt: data.theme.shared.updatedAt ?? now,
  });
}

const initialPreview: ThemePreviewState = {
  isPreviewing: false,
  originalThemeId: null,
  previewConfig: null,
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      activeThemeId: darkTheme.id,
      customThemes: [],
      themeVariantPairs: [],
      preview: initialPreview,
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

      updateCustomTheme(id, config) {
        set((s) => {
          const existing = s.customThemes.find((t) => t.id === id);
          if (!existing) return {};
          const colors: ThemeColors = { ...existing.colors, ...(config.colors ?? {}) };
          const updated = refreshDerived({
            ...existing,
            colors,
            logoUri: config.logoUri ?? existing.logoUri,
            font: config.font ?? existing.font,
            updatedAt: new Date().toISOString(),
          });
          const customThemes = s.customThemes.map((t) => (t.id === id ? updated : t));
          const theme = s.activeThemeId === id ? updated : s.theme;
          return { customThemes, theme };
        });
      },

      removeCustomTheme(id) {
        set((s) => {
          const customThemes = s.customThemes.filter((t) => t.id !== id);
          const activeThemeId = s.activeThemeId === id ? darkTheme.id : s.activeThemeId;
          return { customThemes, activeThemeId, theme: resolveTheme(activeThemeId, customThemes) };
        });
      },

      allThemes() {
        const pairThemes = get().themeVariantPairs.flatMap((p) => [p.light, p.dark]);
        return [...builtInThemes, ...get().customThemes, ...pairThemes];
      },

      startPreview(config) {
        const original = get();
        const previewColors: ThemeColors = {
          ...original.theme.colors,
          ...(config.colors ?? {}),
        };
        const previewTheme = refreshDerived({
          ...original.theme,
          id: `${original.activeThemeId}-preview`,
          name: `${original.theme.name} (Preview)`,
          colors: previewColors,
          logoUri: config.logoUri ?? original.theme.logoUri,
          font: config.font ?? original.theme.font,
        });
        set({
          preview: {
            isPreviewing: true,
            originalThemeId: original.activeThemeId,
            previewConfig: config,
          },
          activeThemeId: previewTheme.id,
          theme: previewTheme,
        });
      },

      updatePreview(config) {
        const current = get().preview;
        if (!current.isPreviewing) return;
        const merged: ThemePreviewConfig = {
          ...(current.previewConfig ?? {}),
          colors: { ...(current.previewConfig?.colors ?? {}), ...(config.colors ?? {}) },
          logoUri: config.logoUri ?? current.previewConfig?.logoUri,
          font: config.font ?? current.previewConfig?.font,
        };
        set({ preview: { ...current, previewConfig: merged } });
      },

      applyPreview() {
        const { preview } = get();
        if (!preview.isPreviewing || !preview.previewConfig) return;
        const base = get().theme.mode === 'dark' ? darkTheme : lightTheme;
        const config = preview.previewConfig;
        const id = generateUniqueThemeId();
        const applied = createBrandTheme(
          base,
          {
            primary: config.colors?.primary ?? base.colors.primary,
            secondary: config.colors?.secondary ?? base.colors.secondary,
            accent: config.colors?.accent ?? base.colors.accent,
            logoUri: config.logoUri,
            font: config.font,
          },
          id,
          'Preview Theme'
        );
        set((s) => ({
          customThemes: [...s.customThemes.filter((t) => t.id !== id), applied],
          activeThemeId: id,
          theme: applied,
          preview: initialPreview,
        }));
      },

      discardPreview() {
        const { preview } = get();
        const originalThemeId = preview.originalThemeId ?? get().activeThemeId;
        const customThemes = get().customThemes;
        set({
          preview: initialPreview,
          activeThemeId: originalThemeId,
          theme: resolveTheme(originalThemeId, customThemes),
        });
      },

      addThemeVariantPair(pair) {
        set((s) => ({
          themeVariantPairs: [
            ...s.themeVariantPairs.filter((p) => p.sharedConfig.id !== pair.sharedConfig.id),
            pair,
          ],
        }));
      },

      removeThemeVariantPair(sharedId) {
        set((s) => {
          const pair = s.themeVariantPairs.find((p) => p.sharedConfig.id === sharedId);
          if (!pair) return {};
          const themeVariantPairs = s.themeVariantPairs.filter(
            (p) => p.sharedConfig.id !== sharedId
          );
          const pairIds = [pair.light.id, pair.dark.id];
          const activeThemeId = pairIds.includes(s.activeThemeId) ? darkTheme.id : s.activeThemeId;
          return {
            themeVariantPairs,
            activeThemeId,
            theme: resolveTheme(activeThemeId, s.customThemes),
          };
        });
      },

      getVariantPair(sharedId) {
        return get().themeVariantPairs.find((p) => p.sharedConfig.id === sharedId);
      },

      exportTheme: ((arg) => {
        if (typeof arg === 'string') {
          const theme = resolveTheme(arg, get().customThemes);
          if (!theme) return null;
          const { cssVariables: _css, ...rest } = theme;
          const payload: ThemeExport = { version: 1, theme: rest };
          return JSON.stringify(payload, null, 2);
        }
        return exportDataForTheme(arg);
      }) as {
        (id: string): string | null;
        (theme: Theme): ThemeExportData;
      },

      importTheme(arg) {
        if (typeof arg === 'string') {
          try {
            const parsed: unknown = JSON.parse(arg);
            if (
              typeof parsed !== 'object' ||
              parsed === null ||
              (parsed as ThemeExport).version !== 1 ||
              typeof (parsed as ThemeExport).theme !== 'object'
            ) {
              return null;
            }
            const imported = refreshDerived((parsed as ThemeExport).theme as Theme);
            set((s) => ({
              customThemes: [...s.customThemes.filter((t) => t.id !== imported.id), imported],
            }));
            return imported.id;
          } catch {
            return null;
          }
        }
        const imported = themeFromExportData(arg);
        set((s) => ({
          customThemes: [...s.customThemes.filter((t) => t.id !== imported.id), imported],
          activeThemeId: imported.id,
          theme: imported,
        }));
        return imported.id;
      },
    }),
    {
      name: 'subtrackr-theme',
      storage: createJSONStorage(() => AsyncStorage),
      // Do not persist derived fields — regenerated on rehydration.
      partialize: (s) => ({
        activeThemeId: s.activeThemeId,
        customThemes: s.customThemes.map(({ cssVariables: _css, ...t }) => t),
        themeVariantPairs: s.themeVariantPairs.map((p) => ({
          ...p,
          light: (() => {
            const { cssVariables: _l, ...light } = p.light;
            return light;
          })(),
          dark: (() => {
            const { cssVariables: _d, ...dark } = p.dark;
            return dark;
          })(),
        })),
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.customThemes = state.customThemes.map((t) => refreshDerived(t));
          state.themeVariantPairs = state.themeVariantPairs.map((p) => ({
            ...p,
            light: refreshDerived(p.light),
            dark: refreshDerived(p.dark),
          }));
          state.theme = resolveTheme(state.activeThemeId, state.customThemes);
        }
      },
    }
  )
);
