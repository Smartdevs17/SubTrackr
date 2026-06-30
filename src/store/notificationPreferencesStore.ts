import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import type { OptInCategory, NotificationPriority } from '../services/pushScheduleEngine';

export interface QuietHoursConfig {
  enabled: boolean;
  startHour: number; // 0-23
  endHour: number; // 0-23
  timezone: string;
}

export interface NotificationPreferences {
  /** Per-category opt-in flags */
  optInCategories: Record<OptInCategory, boolean>;
  /** Digest batching instead of individual pushes */
  digestFrequency: 'immediate' | 'daily' | 'weekly';
  /** Quiet hours configuration */
  quietHours: QuietHoursConfig;
  /** Minimum priority to show: critical-only, informative+, or all */
  minimumPriority: NotificationPriority;
  /** A/B test variant assigned to this user */
  abVariant: 'A' | 'B';
}

interface NotificationPreferencesState {
  preferences: NotificationPreferences;
  updatePreferences: (patch: Partial<NotificationPreferences>) => void;
  toggleCategory: (category: OptInCategory) => void;
  setQuietHours: (qh: Partial<QuietHoursConfig>) => void;
  resetToDefaults: () => void;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  optInCategories: {
    billing: true,
    product: true,
    marketing: false,
    security: true,
  },
  digestFrequency: 'immediate',
  quietHours: {
    enabled: false,
    startHour: 22,
    endHour: 8,
    timezone: 'UTC',
  },
  minimumPriority: 'informative',
  abVariant: Math.random() < 0.5 ? 'A' : 'B',
};

export const useNotificationPreferencesStore = create<NotificationPreferencesState>()(
  persist(
    (set) => ({
      preferences: DEFAULT_PREFERENCES,

      updatePreferences: (patch) =>
        set((state) => ({
          preferences: { ...state.preferences, ...patch },
        })),

      toggleCategory: (category) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            optInCategories: {
              ...state.preferences.optInCategories,
              [category]: !state.preferences.optInCategories[category],
            },
          },
        })),

      setQuietHours: (qh) =>
        set((state) => ({
          preferences: {
            ...state.preferences,
            quietHours: { ...state.preferences.quietHours, ...qh },
          },
        })),

      resetToDefaults: () => set({ preferences: DEFAULT_PREFERENCES }),
    }),
    {
      name: 'subtrackr-notification-preferences',
      storage: createJSONStorage(() => asyncStorageAdapter),
    }
  )
);
