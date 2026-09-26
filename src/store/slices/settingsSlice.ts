/**
 * settingsSlice.ts — Settings slice for the slices-pattern store.
 */

import { SliceCreator } from './types';
import type { AppState } from './state';
import { currencyService, ExchangeRates } from '../../services/currencyService';

export interface SettingsSlice {
  preferredCurrency: string;
  notificationsEnabled: boolean;
  exchangeRates: ExchangeRates | null;
  healthScoreWeights: Record<string, number> | null;
  isLoading: boolean;

  setPreferredCurrency: (currency: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setHealthScoreWeights: (weights: Record<string, number>) => void;
  updateExchangeRates: () => Promise<void>;
  initializeSettings: () => Promise<void>;
}

export type SettingsStoreState = AppState;

export const createSettingsSlice: SliceCreator<SettingsSlice> = (set, get) => ({
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
});
