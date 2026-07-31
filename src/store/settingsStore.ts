import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import { currencyService, ExchangeRates } from '../services/currencyService';

interface SettingsState {
  preferredCurrency: string;
  notificationsEnabled: boolean;
  exchangeRates: ExchangeRates | null;
  healthScoreWeights: Record<string, number> | null;
  isLoading: boolean;

  // Actions
  setPreferredCurrency: (currency: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setHealthScoreWeights: (weights: Record<string, number>) => void;
  updateExchangeRates: () => Promise<void>;
  initializeSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      preferredCurrency: 'USD',
      notificationsEnabled: true,
      exchangeRates: null,
      healthScoreWeights: null,
      isLoading: false,

      setPreferredCurrency: (currency) => {
        set({ preferredCurrency: currency });
        void get().updateExchangeRates();
      },

      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),

      setHealthScoreWeights: (weights) => set({ healthScoreWeights: weights }),

      updateExchangeRates: async () => {
        set({ isLoading: true });
        const rates = await currencyService.fetchRates('USD');
        set({ exchangeRates: rates, isLoading: false });
      },

      initializeSettings: async () => {
        const { exchangeRates } = get();
        if (!exchangeRates || currencyService.isCacheExpired(exchangeRates.timestamp)) {
          await get().updateExchangeRates();
        }
      },
    }),
    {
      name: 'subtrackr-settings-store',
      storage: createJSONStorage(() => asyncStorageAdapter),
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn('[settingsStore] Hydration error — resetting to defaults:', error);
          useSettingsStore.setState({
            preferredCurrency: 'USD',
            notificationsEnabled: true,
            exchangeRates: null,
            isLoading: false,
          });
        }
      },
    }
  )
);
