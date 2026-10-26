export enum Currency {
  USD = 'USD',
  EUR = 'EUR',
  GBP = 'GBP',
  CAD = 'CAD',
  AUD = 'AUD',
  JPY = 'JPY',
  // Add more as needed
}

export interface FXConversionResult {
  originalAmount: number;
  originalCurrency: Currency;
  convertedAmount: number;
  targetCurrency: Currency;
  exchangeRate: number;
  timestamp: number;
}

export class FXService {
  private cache: Map<string, { rate: number; expiresAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  async getExchangeRate(from: Currency, to: Currency): Promise<number> {
    if (from === to) return 1.0;
    
    const cacheKey = `${from}_${to}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.rate;
    }

    try {
      const rate = await this.fetchRateFromOracle(from, to);
      this.cache.set(cacheKey, {
        rate,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });
      return rate;
    } catch (error) {
      console.warn('FX Provider unavailable, using fallback', error);
      if (cached) {
        return cached.rate;
      }
      throw new Error(`Unable to fetch exchange rate for ${from} to ${to}`);
    }
  }

  async convert(amount: number, from: Currency, to: Currency): Promise<FXConversionResult> {
    if (amount === 0) {
      return {
        originalAmount: amount,
        originalCurrency: from,
        convertedAmount: 0,
        targetCurrency: to,
        exchangeRate: 1,
        timestamp: Date.now(),
      };
    }

    const rate = await this.getExchangeRate(from, to);
    return {
      originalAmount: amount,
      originalCurrency: from,
      convertedAmount: amount * rate,
      targetCurrency: to,
      exchangeRate: rate,
      timestamp: Date.now(),
    };
  }

  private async fetchRateFromOracle(from: Currency, to: Currency): Promise<number> {
    // Simulated Oracle Integration
    return 1.1; 
  }
}
