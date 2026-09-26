import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = 'https://api.frankfurter.dev/v1'; // Update to v1 or v2 as per documentation
const RATES_CACHE_KEY = '@subtrackr_exchange_rates';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

export interface ExchangeRates {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
  timestamp: number;
}

class CurrencyService {
  /**
   * Fetch exchange rates from the API
   * @param base The base currency (default: USD)
   */
  async fetchRates(base: string = 'USD'): Promise<ExchangeRates | null> {
    try {
      const response = await fetch(`${BASE_URL}/latest?from=${base}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch rates: ${response.statusText}`);
      }
      const data = await response.json();
      const result: ExchangeRates = {
        ...data,
        timestamp: Date.now(),
      };

      // Cache the rates
      await AsyncStorage.setItem(RATES_CACHE_KEY, JSON.stringify(result));
      return result;
    } catch (error) {
      console.error('CurrencyService fetchRates error:', error);
      return this.getCachedRates();
    }
  }

  /**
   * Get cached rates from AsyncStorage
   */
  async getCachedRates(): Promise<ExchangeRates | null> {
    try {
      const cached = await AsyncStorage.getItem(RATES_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('CurrencyService getCachedRates error:', error);
    }
    return null;
  }

  /**
   * Convert an amount from one currency to another
   * @param amount The value to convert
   * @param from Origin currency code
   * @param to Target currency code
   * @param rates Current exchange rates (relative to a base, usually USD)
   */
  convert(
    amount: number,
    from: string,
    to: string,
    rates: Record<string, number>,
    base: string = 'USD'
  ): number {
    if (from === to) return amount;

    // Convert to base first
    let amountInBase = amount;
    if (from !== base) {
      const rateFromBase = rates[from];
      if (!rateFromBase) return amount; // Fallback to original if rate missing
      amountInBase = amount / rateFromBase;
    }

    // Convert from base to target
    if (to === base) return amountInBase;
    const rateToBase = rates[to];
    if (!rateToBase) return amountInBase; // Fallback to base if rate missing

    return amountInBase * rateToBase;
  }

  /**
   * Check if cached rates are expired
   */
  isCacheExpired(timestamp: number): boolean {
    return Date.now() - timestamp > CACHE_EXPIRY;
  }
}

export const currencyService = new CurrencyService();
