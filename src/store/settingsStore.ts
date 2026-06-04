import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { currencyService, ExchangeRates } from '../services/currencyService';

interface SettingsState {
  preferredCurrency: string;
  notificationsEnabled: boolean;
  exchangeRates: ExchangeRates | null;
  isLoading: boolean;

  // Actions
  setPreferredCurrency: (currency: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  updateExchangeRates: () => Promise<void>;
  initializeSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      preferredCurrency: 'USD',
      notificationsEnabled: true,
      exchangeRates: null,
      isLoading: false,

      setPreferredCurrency: (currency) => {
        set({ preferredCurrency: currency });
        // Optionally update rates immediately if base changed,
        // but here we keep USD as base for rates to simplify conversion
        void get().updateExchangeRates();
      },

      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),

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
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
