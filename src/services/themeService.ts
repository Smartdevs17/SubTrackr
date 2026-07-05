import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Theme, ThemeExportData, ThemeConfig, ThemeVariantPair } from '../theme/types';

const API_BASE = '/api/v1/merchant/themes';
const THEME_API_KEY = 'subtrackr-theme-api-sync';

export interface ThemeApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  requestId?: string;
}

interface ThemeApiRecord {
  id: string;
  name: string;
  config: ThemeConfig;
  createdAt: string;
  updatedAt: string;
}

const defaultHeaders = { 'Content-Type': 'application/json' };

export const themeService = {
  async fetchThemes(): Promise<ThemeApiResponse<ThemeApiRecord[]>> {
    try {
      const cached = await AsyncStorage.getItem(THEME_API_KEY);
      if (cached) {
        return { success: true, data: JSON.parse(cached) };
      }
      return { success: true, data: [] };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to fetch themes',
      };
    }
  },

  async saveTheme(theme: Theme): Promise<ThemeApiResponse<ThemeApiRecord>> {
    const record: ThemeApiRecord = {
      id: theme.id,
      name: theme.name,
      config: {
        colors: {
          primary: theme.colors.primary,
          secondary: theme.colors.secondary,
          accent: theme.colors.accent,
          success: theme.colors.success,
          warning: theme.colors.warning,
          error: theme.colors.error,
        },
        fonts: theme.fonts,
        logo: theme.logo,
        metadata: theme.metadata,
      },
      createdAt: theme.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const cached = await AsyncStorage.getItem(THEME_API_KEY);
      const themes: ThemeApiRecord[] = cached ? JSON.parse(cached) : [];
      const idx = themes.findIndex((t) => t.id === theme.id);
      if (idx >= 0) {
        themes[idx] = record;
      } else {
        themes.push(record);
      }
      await AsyncStorage.setItem(THEME_API_KEY, JSON.stringify(themes));
      return { success: true, data: record };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to save theme' };
    }
  },

  async saveThemeVariantPair(pair: ThemeVariantPair): Promise<ThemeApiResponse<ThemeApiRecord[]>> {
    const records: ThemeApiRecord[] = [pair.light, pair.dark].map((theme) => ({
      id: theme.id,
      name: theme.name,
      config: {
        colors: {
          primary: theme.colors.primary,
          secondary: theme.colors.secondary,
          accent: theme.colors.accent,
          success: theme.colors.success,
          warning: theme.colors.warning,
          error: theme.colors.error,
          background: theme.colors.background,
          surface: theme.colors.surface,
          text: theme.colors.text,
          textSecondary: theme.colors.textSecondary,
        },
        fonts: theme.fonts,
        logo: theme.logo,
        metadata: {
          ...theme.metadata,
          variantPairId: pair.sharedConfig.id,
          variantName: pair.sharedConfig.name,
        },
      },
      createdAt: theme.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    try {
      const cached = await AsyncStorage.getItem(THEME_API_KEY);
      const themes: ThemeApiRecord[] = cached ? JSON.parse(cached) : [];
      for (const record of records) {
        const idx = themes.findIndex((t) => t.id === record.id);
        if (idx >= 0) {
          themes[idx] = record;
        } else {
          themes.push(record);
        }
      }
      await AsyncStorage.setItem(THEME_API_KEY, JSON.stringify(themes));
      return { success: true, data: records };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to save theme pair',
      };
    }
  },

  async deleteTheme(id: string): Promise<ThemeApiResponse<void>> {
    try {
      const cached = await AsyncStorage.getItem(THEME_API_KEY);
      if (cached) {
        const themes: ThemeApiRecord[] = JSON.parse(cached);
        const filtered = themes.filter((t) => t.id !== id);
        await AsyncStorage.setItem(THEME_API_KEY, JSON.stringify(filtered));
      }
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to delete theme',
      };
    }
  },

  async syncThemesToRemote(themes: Theme[]): Promise<ThemeApiResponse<{ synced: number }>> {
    let synced = 0;
    for (const theme of themes) {
      const result = await this.saveTheme(theme);
      if (result.success) synced++;
    }
    return { success: true, data: { synced } };
  },

  async exportTheme(theme: Theme): Promise<ThemeExportData> {
    const config: ThemeConfig = {
      colors: {
        primary: theme.colors.primary,
        secondary: theme.colors.secondary,
        accent: theme.colors.accent,
        success: theme.colors.success,
        warning: theme.colors.warning,
        error: theme.colors.error,
        background: theme.colors.background,
        surface: theme.colors.surface,
        text: theme.colors.text,
        textSecondary: theme.colors.textSecondary,
      },
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
  },

  async importTheme(exportData: ThemeExportData): Promise<ThemeApiResponse<Theme>> {
    try {
      const { shared } = exportData.theme;
      const modeConfig = exportData.theme.light || exportData.theme.dark;
      if (!modeConfig) {
        return { success: false, error: 'No theme config found in export data' };
      }
      const { buildThemeFromConfig } = await import('../theme/customThemeBuilder');
      const theme = buildThemeFromConfig(
        modeConfig,
        exportData.theme.dark ? 'dark' : 'light',
        shared.id || `imported-${Date.now()}`,
        shared.name || 'Imported Theme'
      );
      return { success: true, data: theme };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to import theme',
      };
    }
  },
};
