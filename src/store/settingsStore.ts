/**
 * settingsStore.ts — Settings state (slices pattern).
 *
 * Delegates to the combined `useAppStore` (see slices/index.ts). The legacy
 * `useSettingsStore` hook is preserved for compatibility.
 */

import { useAppStore, SettingsSlice } from './slices';
import { currencyService, ExchangeRates } from '../services/currencyService';

export type SettingsState = SettingsSlice;

export const useSettingsStore = useAppStore;

export type { ExchangeRates };
export { currencyService };
