import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { currencyService, ExchangeRates } from '../services/currencyService';
import { LoadingState, idle, loading, success, failure } from '../types/loadingState';

interface SettingsState {
  preferredCurrency: string;
  notificationsEnabled: boolean;
  exchangeRates: ExchangeRates | null;
  isLoading: boolean;
  loadingState: LoadingState;

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
      loadingState: idle(),

      setPreferredCurrency: (currency) => {
        set({ preferredCurrency: currency });
        void get().updateExchangeRates();
      },

      setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),

      updateExchangeRates: async () => {
        set({ isLoading: true, loadingState: loading() });
        try {
          const rates = await currencyService.fetchRates('USD');
          set({ exchangeRates: rates, isLoading: false, loadingState: success() });
        } catch (e) {
          set({ isLoading: false, loadingState: failure(e as Error, ['Check your internet connection', 'Try again later']) });
        }
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
